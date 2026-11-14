import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildCleanEnv, getKokoroPaths } from "./env";
import { ClaudianVoiceSettings } from "./types";

export class TtsSpeaker {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private stdoutBuffer = "";
  private pendingResolve: ((line: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private synthQueue: Promise<unknown> = Promise.resolve();

  private activeAudio: HTMLAudioElement | null = null;
  private activeAbort: AbortController | null = null;
  private playQueue: string[] = [];
  private isPlaying = false;
  private generation = 0;

  onSpeakingChange?: (speaking: boolean) => void;

  constructor(private getSettings: () => ClaudianVoiceSettings) {}

  private ensureKokoroWorker(): Promise<void> {
    if (this.worker && this.readyPromise) {
      return this.readyPromise;
    }

    const kp = getKokoroPaths();
    if (!kp.installed) {
      return Promise.reject(
        new Error("Kokoro TTS not installed in ~/.cache/obsidian-read-aloud")
      );
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn(kp.pythonPath, [kp.workerPath, kp.modelPath, kp.voicesPath], {
        env: buildCleanEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.worker = child;
      this.stdoutBuffer = "";
      let stderrTail = "";

      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
      });

      child.stdout.on("data", (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString("utf8");
        let idx: number;
        while ((idx = this.stdoutBuffer.indexOf("\n")) !== -1) {
          const line = this.stdoutBuffer.slice(0, idx).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
          if (!line) continue;

          if (!settled) {
            if (!line.startsWith("{")) {
              console.warn("[claudian-voice] Kokoro startup log:", line);
              continue;
            }
            try {
              const msg = JSON.parse(line);
              if (msg.ready) {
                settled = true;
                resolve();
              } else {
                settled = true;
                reject(new Error(msg.error || "Kokoro worker failed"));
              }
            } catch {
              console.warn("[claudian-voice] Kokoro startup log:", line);
            }
            continue;
          }

          if (this.pendingResolve) {
            const fn = this.pendingResolve;
            this.pendingResolve = null;
            this.pendingReject = null;
            fn(line);
          }
        }
      });

      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else if (this.pendingReject) {
          const fn = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          fn(err);
        }
        this.worker = null;
        this.readyPromise = null;
      });

      child.on("close", (code) => {
        const err = new Error(
          `Kokoro worker exited (code ${code})${stderrTail ? `: ${stderrTail.trim()}` : ""}`
        );
        if (!settled) {
          settled = true;
          reject(err);
        } else if (this.pendingReject) {
          const fn = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          fn(err);
        }
        this.worker = null;
        this.readyPromise = null;
      });
    });

    return this.readyPromise;
  }

  private synthesizeKokoro(text: string): Promise<ArrayBuffer> {
    const run = async (): Promise<ArrayBuffer> => {
      await this.ensureKokoroWorker();
      const s = this.getSettings();
      const tmpWav = path.join(
        os.tmpdir(),
        `claudian-voice-out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`
      );
      try {
        const line = await new Promise<string>((resolve, reject) => {
          if (!this.worker) {
            reject(new Error("Kokoro worker not running"));
            return;
          }
          this.pendingResolve = resolve;
          this.pendingReject = reject;
          const payload = JSON.stringify({
            text,
            voice: s.kokoroVoice || "af_heart",
            speed: s.speechRate || 1.0,
            out_wav: tmpWav,
          });
          this.worker.stdin.write(payload + "\n");
        });
        const parsed = JSON.parse(line);
        if (!parsed.ok) {
          throw new Error(parsed.error || "Kokoro synthesis failed");
        }
        const buf = fs.readFileSync(tmpWav);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } finally {
        try {
          fs.unlinkSync(tmpWav);
        } catch {
          // ignore
        }
      }
    };

    const next = this.synthQueue.then(run, run);
    this.synthQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private playWavBuffer(buffer: ArrayBuffer, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.activeAudio = audio;
      let settled = false;

      const cleanup = () => {
        if (this.activeAudio === audio) this.activeAudio = null;
        URL.revokeObjectURL(url);
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        audio.pause();
        audio.src = "";
        cleanup();
        reject(new Error("Aborted"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      audio.onended = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      audio.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch((err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private speakWebSpeech(text: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        reject(new Error("Web Speech API unavailable"));
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = this.getSettings().speechRate || 1.0;

      const onAbort = () => {
        window.speechSynthesis.cancel();
        reject(new Error("Aborted"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      utter.onend = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      utter.onerror = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Web Speech error"));
      };
      window.speechSynthesis.speak(utter);
    });
  }

  enqueue(text: string): void {
    const cleaned = text.trim();
    if (!cleaned) return;
    this.playQueue.push(cleaned);
    if (!this.isPlaying) {
      void this.drainQueue();
    }
  }

  get speaking(): boolean {
    return this.isPlaying || this.playQueue.length > 0;
  }

  private async drainQueue(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    const myGen = this.generation;
    this.onSpeakingChange?.(true);

    try {
      // Prefetch next synthesis while current plays
      let prefetched: Promise<ArrayBuffer> | null = null;

      while (this.playQueue.length > 0 && this.generation === myGen) {
        const text = this.playQueue.shift()!;
        const s = this.getSettings();
        const useKokoro = s.ttsEngine === "kokoro" && getKokoroPaths().installed;

        const ctrl = new AbortController();
        this.activeAbort = ctrl;

        try {
          if (useKokoro) {
            const bufPromise = prefetched ?? this.synthesizeKokoro(text);
            prefetched = null;

            // Start synthesizing the next queued chunk in parallel!
            if (this.playQueue.length > 0) {
              prefetched = this.synthesizeKokoro(this.playQueue[0]);
            }

            const buf = await bufPromise;
            if (this.generation !== myGen || ctrl.signal.aborted) break;
            await this.playWavBuffer(buf, ctrl.signal);
          } else {
            await this.speakWebSpeech(text, ctrl.signal);
          }
        } catch (err) {
          if (ctrl.signal.aborted || this.generation !== myGen) break;
          console.error("[claudian-voice] TTS error:", err);
        } finally {
          if (this.activeAbort === ctrl) this.activeAbort = null;
        }
      }
    } finally {
      this.isPlaying = false;
      this.onSpeakingChange?.(false);
    }
  }

  stop(): void {
    this.generation++;
    this.playQueue = [];
    this.activeAbort?.abort();
    this.activeAbort = null;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = "";
      this.activeAudio = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.isPlaying = false;
    this.onSpeakingChange?.(false);
  }

  dispose(): void {
    this.stop();
    if (this.pendingReject) {
      this.pendingReject(new Error("Kokoro worker disposed"));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
    if (this.worker) {
      this.worker.kill("SIGTERM");
      this.worker = null;
    }
    this.readyPromise = null;
  }
}
