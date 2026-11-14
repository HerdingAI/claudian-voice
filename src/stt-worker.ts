import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildCleanEnv, resolveSttPython } from "./env";
import { ClaudianVoiceSettings } from "./types";

export interface SttResult {
  text: string;
  sttMs: number;
  language?: string;
}

export class SttWorkerClient {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private readyPromise: Promise<void> | null = null;
  private activeModel = "";
  private activeDevice = "";
  private stdoutBuffer = "";
  private pendingResolve: ((line: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private pluginDir: string,
    private getSettings: () => ClaudianVoiceSettings
  ) {}

  private ensureWorker(): Promise<void> {
    const s = this.getSettings();
    if (
      this.worker &&
      this.readyPromise &&
      this.activeModel === s.sttModel &&
      this.activeDevice === s.sttDevice
    ) {
      return this.readyPromise;
    }

    this.dispose();

    const pythonExec = resolveSttPython(s.sttPythonPath);
    const workerScript = path.join(this.pluginDir, "stt_worker.py");
    if (!fs.existsSync(workerScript)) {
      return Promise.reject(new Error(`STT worker not found at ${workerScript}`));
    }

    this.activeModel = s.sttModel;
    this.activeDevice = s.sttDevice;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn(pythonExec, [workerScript, s.sttModel, s.sttDevice], {
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
              console.warn("[claudian-voice] STT startup log:", line);
              continue;
            }
            try {
              const msg = JSON.parse(line);
              if (msg.ready) {
                settled = true;
                resolve();
              } else {
                settled = true;
                reject(new Error(msg.error || "STT worker failed to initialize"));
              }
            } catch {
              console.warn("[claudian-voice] STT startup log:", line);
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
          `STT worker exited (code ${code})${stderrTail ? `: ${stderrTail.trim()}` : ""}`
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

  async transcribeWavBytes(wavBuffer: ArrayBuffer): Promise<SttResult> {
    const run = async (): Promise<SttResult> => {
      await this.ensureWorker();
      const s = this.getSettings();
      const tmpWav = path.join(
        os.tmpdir(),
        `claudian-voice-in-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`
      );
      fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));

      try {
        const line = await new Promise<string>((resolve, reject) => {
          if (!this.worker) {
            reject(new Error("STT worker not running"));
            return;
          }
          this.pendingResolve = resolve;
          this.pendingReject = reject;
          const payload = JSON.stringify({
            wav: tmpWav,
            language: s.sttLanguage || "en",
          });
          this.worker.stdin.write(payload + "\n");
        });

        const parsed = JSON.parse(line);
        if (!parsed.ok) {
          throw new Error(parsed.error || "STT transcription failed");
        }
        return {
          text: String(parsed.text || "").trim(),
          sttMs: Number(parsed.stt_ms || 0),
          language: parsed.language,
        };
      } finally {
        try {
          fs.unlinkSync(tmpWav);
        } catch {
          // ignore cleanup failure
        }
      }
    };

    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  dispose(): void {
    if (this.pendingReject) {
      this.pendingReject(new Error("STT worker disposed"));
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
