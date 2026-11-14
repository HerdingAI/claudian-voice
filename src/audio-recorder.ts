import { ClaudianVoiceSettings } from "./types";

export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : input[Math.min(start, input.length - 1)];
  }
  return out;
}

export function encodeWav16kMono(samples: Float32Array): ArrayBuffer {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, 16000, true); // sample rate
  view.setUint32(28, 16000 * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function computeRms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i] * buf[i];
  }
  return Math.sqrt(sum / Math.max(1, buf.length));
}

export class VoiceAudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  private mode: "idle" | "ptt" | "vad" = "idle";
  private pttChunks: Float32Array[] = [];

  // VAD state
  private vadPaused = false;
  private vadInSpeech = false;
  private vadSpeechChunks: Float32Array[] = [];
  private vadPreRoll: Float32Array[] = [];
  private vadSpeechStartMs = 0;
  private vadLastVoiceMs = 0;
  private vadOnsetMs = 0;
  private onVadUtterance?: (wav: ArrayBuffer) => void;
  private onVadSpeechStart?: () => void;
  private onLevel?: (rms: number) => void;

  constructor(private getSettings: () => ClaudianVoiceSettings) {}

  private async ensureGraph(): Promise<void> {
    if (this.stream && this.ctx && this.processor) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.processor = ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(input, ctx.sampleRate);
      const rms = computeRms(down);
      this.onLevel?.(rms);

      if (this.mode === "ptt") {
        this.pttChunks.push(down);
      } else if (this.mode === "vad" && !this.vadPaused) {
        this.processVadFrame(down, rms);
      }
    };

    // Connect through a zero-gain node so ScriptProcessor fires without audio feedback
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(silentGain);
    silentGain.connect(ctx.destination);
  }

  private processVadFrame(frame: Float32Array, rms: number): void {
    const s = this.getSettings();
    const now = performance.now();
    const isVoice = rms >= s.vadThreshold;

    if (!this.vadInSpeech) {
      // Keep ~350ms pre-roll (at 16kHz, ~6000 samples)
      this.vadPreRoll.push(frame);
      if (this.vadPreRoll.length > 4) {
        this.vadPreRoll.shift();
      }

      if (isVoice) {
        if (this.vadOnsetMs === 0) {
          this.vadOnsetMs = now;
        } else if (now - this.vadOnsetMs >= 120) {
          this.vadInSpeech = true;
          this.vadSpeechStartMs = this.vadOnsetMs;
          this.vadLastVoiceMs = now;
          this.vadSpeechChunks = [...this.vadPreRoll];
          this.vadPreRoll = [];
          this.onVadSpeechStart?.();
        }
      } else {
        this.vadOnsetMs = 0;
      }
      return;
    }

    // Currently in speech
    this.vadSpeechChunks.push(frame);
    if (isVoice) {
      this.vadLastVoiceMs = now;
    } else if (now - this.vadLastVoiceMs >= s.vadSilenceMs) {
      const durationMs = this.vadLastVoiceMs - this.vadSpeechStartMs;
      const chunks = this.vadSpeechChunks;
      this.vadInSpeech = false;
      this.vadSpeechChunks = [];
      this.vadOnsetMs = 0;

      if (durationMs >= s.minSpeechMs && chunks.length > 0) {
        const merged = concatFloat32(chunks);
        const wav = encodeWav16kMono(merged);
        this.onVadUtterance?.(wav);
      }
    }
  }

  async startPushToTalk(onLevel?: (rms: number) => void): Promise<void> {
    this.pttChunks = [];
    this.onLevel = onLevel;
    this.mode = "ptt";
    await this.ensureGraph();
  }

  stopPushToTalk(): ArrayBuffer | null {
    if (this.mode !== "ptt") return null;
    this.mode = "idle";
    this.onLevel = undefined;
    const chunks = this.pttChunks;
    this.pttChunks = [];
    this.teardownGraph();
    if (chunks.length === 0) return null;
    const merged = concatFloat32(chunks);
    if (merged.length < 1600) return null; // <100ms
    return encodeWav16kMono(merged);
  }

  cancelPushToTalk(): void {
    this.mode = "idle";
    this.pttChunks = [];
    this.onLevel = undefined;
    this.teardownGraph();
  }

  async startVad(opts: {
    onUtterance: (wav: ArrayBuffer) => void;
    onSpeechStart?: () => void;
    onLevel?: (rms: number) => void;
  }): Promise<void> {
    this.vadOnsetMs = 0;
    this.vadInSpeech = false;
    this.vadSpeechChunks = [];
    this.vadPreRoll = [];
    this.vadPaused = false;
    this.onVadUtterance = opts.onUtterance;
    this.onVadSpeechStart = opts.onSpeechStart;
    this.onLevel = opts.onLevel;
    this.mode = "vad";
    await this.ensureGraph();
  }

  pauseVad(): void {
    this.vadPaused = true;
    this.vadInSpeech = false;
    this.vadSpeechChunks = [];
    this.vadPreRoll = [];
    this.vadOnsetMs = 0;
  }

  resumeVad(): void {
    this.vadPaused = false;
    this.vadInSpeech = false;
    this.vadSpeechChunks = [];
    this.vadPreRoll = [];
    this.vadOnsetMs = 0;
  }

  stopVad(): void {
    this.mode = "idle";
    this.vadPaused = false;
    this.vadInSpeech = false;
    this.vadSpeechChunks = [];
    this.vadPreRoll = [];
    this.onVadUtterance = undefined;
    this.onVadSpeechStart = undefined;
    this.onLevel = undefined;
    this.teardownGraph();
  }

  private teardownGraph(): void {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      // ignore
    }
    this.processor = null;
    this.source = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  dispose(): void {
    this.cancelPushToTalk();
    this.stopVad();
  }
}
