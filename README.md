# Claudian Voice

Back-and-forth voice interaction for the **Claudian** Obsidian plugin, powered by local **faster-whisper** Speech-to-Text and local **Kokoro** Text-to-Speech.

## Features

- **Push-to-Talk**: Click the microphone button in Claudian's toolbar (or bind a hotkey to `Toggle Push-to-Talk for Claudian`) to record, transcribe, and submit.
- **Hands-Free Mode**: Click the waveform button (or `Toggle Hands-Free Voice Conversation for Claudian`) for continuous back-and-forth voice chat with RMS voice-activity detection, automatic mic muting while Claudian responds, and barge-in interruption.
- **Streaming Local TTS**: Speaks Claudian's `.claudian-text-block` replies sentence-by-sentence via Kokoro ONNX (`~/.cache/obsidian-read-aloud`) with Web Speech fallback.

## Requirements

- **Claudian** (`realclaudian`) plugin installed in your Obsidian vault.
- **Local Whisper STT**: Python environment with `faster-whisper` (defaults to `~/.venvs/audio/bin/python3`; preloads CUDA libraries in dependency order with automatic CPU `int8` fallback).
- **Local Kokoro TTS** (optional, falls back to Web Speech): Installed via `read-aloud` at `~/.cache/obsidian-read-aloud`.

## Build & Package

```bash
npm install
npm test
npm run package
```

Outputs `dist/claudian-voice-0.1.0.zip` containing `manifest.json`, `main.js`, `styles.css`, and `stt_worker.py`.
