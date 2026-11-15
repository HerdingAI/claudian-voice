# Claudian Voice

Back-and-forth local voice conversation (**Push-to-Talk** and **Hands-Free**) for the **Claudian** (`realclaudian`) Obsidian desktop plugin, powered by local **faster-whisper** Speech-to-Text and local **Kokoro** Text-to-Speech.

> **Privacy-first & 100% local:** Audio transcription and speech synthesis run on your own machine—no cloud STT/TTS API keys required.

## Features

- **Push-to-Talk**: Click the microphone button in Claudian's toolbar (or bind a hotkey to `Toggle Push-to-Talk for Claudian`) to record, transcribe locally, and submit.
- **Hands-Free Voice Mode**: Click the waveform button (or `Toggle Hands-Free Voice Conversation for Claudian`) for continuous back-and-forth voice chat with RMS voice-activity detection (`750ms` default silence threshold), automatic mic muting while Claudian responds, and barge-in interruption.
- **Streaming Local TTS**: Speaks Claudian's `.claudian-text-block` replies sentence-by-sentence via local **Kokoro ONNX** (`~/.cache/obsidian-read-aloud`), stripping markdown formatting before speech, with automatic Web Speech API fallback.
- **GPU + Automatic CPU Fallback**: `stt_worker.py` preloads NVIDIA CUDA libraries (`libcudart` → `libcublasLt` → `libcublas` → `libcudnn`) for fast GPU inference and automatically falls back to CPU (`int8`) if CUDA libraries are unavailable.

## Prerequisites

1. **Obsidian Desktop** (`v1.5.0+`, `isDesktopOnly: true`).
2. **Claudian (`realclaudian`)** plugin installed and enabled in your vault.
3. **Python 3.10+** with `faster-whisper` for local Speech-to-Text:
   ```bash
   python3 -m venv ~/.venvs/audio
   ~/.venvs/audio/bin/pip install --upgrade pip faster-whisper
   ```
   *(If you use a different Python path, configure it in **Settings → Claudian Voice → Python Path**.)*
4. **Local Kokoro TTS (Optional)**: Installed via `read-aloud` at `~/.cache/obsidian-read-aloud`. If absent, the plugin automatically uses your OS Web Speech API.

## Installation

### Option 1: From GitHub Releases (Recommended)
1. Download `claudian-voice-0.1.0.zip` (or `manifest.json`, `main.js`, `styles.css`, and `stt_worker.py`) from the [Releases](https://github.com/HerdingAI/claudian-voice/releases) page.
2. Extract the files into `<your-vault>/.obsidian/plugins/claudian-voice/`.
   > **Important:** Make sure `stt_worker.py` is placed inside `<your-vault>/.obsidian/plugins/claudian-voice/` alongside `main.js`, `manifest.json`, and `styles.css`.
3. In Obsidian, go to **Settings → Community plugins**, reload plugins, and enable **Claudian Voice**.

### Option 2: Build from Source
```bash
git clone https://github.com/HerdingAI/claudian-voice.git
cd claudian-voice
npm install
npm test
npm run package
```
Copy `manifest.json`, `main.js`, `styles.css`, and `stt_worker.py` (or extract `dist/claudian-voice-0.1.0.zip`) into `<your-vault>/.obsidian/plugins/claudian-voice/`.

## Usage

1. Open the **Claudian** view in Obsidian.
2. Use the new toolbar buttons:
   - **Microphone icon** — Push-to-Talk (click to start, click again to transcribe & send).
   - **Waveform icon** — Hands-Free continuous conversation mode.
3. Optional: Bind Obsidian hotkeys under **Settings → Hotkeys** for:
   - `Toggle Push-to-Talk for Claudian`
   - `Toggle Hands-Free Voice Conversation for Claudian`

## Troubleshooting

- **Whisper fails to load CUDA libraries**: `stt_worker.py` automatically falls back to CPU `int8`. Check **Settings → Claudian Voice** or the Obsidian Developer Console (`Ctrl+Shift+I` / `Cmd+Option+I`) to see whether GPU or CPU mode was selected.
- **No `faster-whisper` found**: Verify `~/.venvs/audio/bin/python3 -c "import faster_whisper"` succeeds, or set your custom Python executable path in plugin settings.
- **No TTS audio**: Confirm Kokoro assets exist in `~/.cache/obsidian-read-aloud` or ensure your OS text-to-speech engine is enabled for Web Speech fallback.

## Claudian Suite

- **[Claudian Mobile](https://github.com/HerdingAI/claudian-mobile)** — Mobile-compatible (`isDesktopOnly: false`) Obsidian plugin for iOS, Android, and Desktop via `claudian-bridge`.
- **[Claudian Bridge](https://github.com/HerdingAI/claudian-bridge)** — Workstation HTTP/SSE server powering Claudian Mobile and Claudian Call.
- **[Claudian Call](https://github.com/HerdingAI/claudian-call)** — Native Android app for screen-off, phone-call-style voice conversations.

## License

MIT — see [LICENSE](LICENSE).
