export type VoiceState =
  | "idle"
  | "listening"     // Hands-free waiting for speech onset
  | "recording"     // Actively capturing speech (push-to-talk or VAD active)
  | "transcribing"  // Running Whisper STT
  | "thinking"      // Waiting for Claudian to respond
  | "speaking";     // Playing Kokoro/WebSpeech TTS

export interface ClaudianVoiceSettings {
  sttModel: string;
  sttDevice: "auto" | "cuda" | "cpu";
  sttLanguage: string;
  sttPythonPath: string;
  ttsEngine: "kokoro" | "webspeech";
  kokoroVoice: string;
  speechRate: number;
  autoSubmit: boolean;
  autoSpeakReplies: boolean;
  skipCodeBlocksInSpeech: boolean;
  vadThreshold: number;
  vadSilenceMs: number;
  minSpeechMs: number;
}

export const DEFAULT_SETTINGS: ClaudianVoiceSettings = {
  sttModel: "small",
  sttDevice: "auto",
  sttLanguage: "en",
  sttPythonPath: "",
  ttsEngine: "kokoro",
  kokoroVoice: "af_heart",
  speechRate: 1.05,
  autoSubmit: true,
  autoSpeakReplies: true,
  skipCodeBlocksInSpeech: true,
  vadThreshold: 0.015,
  vadSilenceMs: 1200,
  minSpeechMs: 350,
};

export const WHISPER_MODELS = [
  { id: "large-v3-turbo", label: "large-v3-turbo (Best accuracy, GPU)" },
  { id: "small", label: "small (Fast, balanced)" },
  { id: "small.en", label: "small.en (Fast English)" },
  { id: "base", label: "base (Ultra-fast)" },
  { id: "tiny.en", label: "tiny.en (Fastest English)" },
];

export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart (US Female, Warm)" },
  { id: "af_bella", label: "Bella (US Female, Clear)" },
  { id: "af_nicole", label: "Nicole (US Female, Soft)" },
  { id: "af_sarah", label: "Sarah (US Female, Crisp)" },
  { id: "am_adam", label: "Adam (US Male, Deep)" },
  { id: "am_michael", label: "Michael (US Male, Natural)" },
  { id: "bf_emma", label: "Emma (UK Female)" },
  { id: "bm_george", label: "George (UK Male)" },
];
