#!/usr/bin/env python3
"""Persistent local faster-whisper STT worker for Claudian Voice."""

from __future__ import annotations

import ctypes
import glob
import json
import os
import site
import sys
import time
from typing import Any

FASTER_WHISPER_MODELS: dict[str, str] = {
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    "large-v3": "Systran/faster-whisper-large-v3",
    "medium": "Systran/faster-whisper-medium",
    "small": "Systran/faster-whisper-small",
    "small.en": "Systran/faster-whisper-small.en",
    "base": "Systran/faster-whisper-base",
    "tiny": "Systran/faster-whisper-tiny",
    "tiny.en": "Systran/faster-whisper-tiny.en",
}

_CUDA_LIBS_PRELOADED = False


def preload_cuda_libraries() -> list[str]:
    """Preload pip-installed NVIDIA CUDA shared libraries with RTLD_GLOBAL."""
    global _CUDA_LIBS_PRELOADED
    if _CUDA_LIBS_PRELOADED:
        return []
    _CUDA_LIBS_PRELOADED = True

    loaded: list[str] = []
    candidate_roots: list[str] = []
    try:
        candidate_roots.extend(site.getsitepackages())
    except Exception:
        pass
    try:
        user_site = site.getusersitepackages()
        if user_site:
            candidate_roots.append(user_site)
    except Exception:
        pass

    patterns = [
        "nvidia/cuda_runtime/lib/libcudart*.so*",
        "nvidia/cublas/lib/libcublasLt*.so*",
        "nvidia/cublas/lib/libcublas*.so*",
        "nvidia/cudnn/lib/libcudnn*.so*",
    ]

    for root in candidate_roots:
        for pattern in patterns:
            for lib_path in sorted(glob.glob(os.path.join(root, pattern))):
                if not os.path.isfile(lib_path):
                    continue
                try:
                    ctypes.CDLL(lib_path, mode=ctypes.RTLD_GLOBAL)
                    loaded.append(os.path.basename(lib_path))
                except OSError:
                    pass
    return loaded


def load_model(model_name: str, device_pref: str = "auto") -> tuple[Any, str]:
    from faster_whisper import WhisperModel

    repo_id = FASTER_WHISPER_MODELS.get(model_name, model_name)
    if device_pref in ("auto", "cuda"):
        preload_cuda_libraries()
        try:
            model = WhisperModel(repo_id, device="cuda", compute_type="float16", local_files_only=True)
            return model, "cuda"
        except Exception:
            try:
                model = WhisperModel(repo_id, device="cuda", compute_type="float16")
                return model, "cuda"
            except Exception:
                if device_pref == "cuda":
                    raise

    try:
        model = WhisperModel(repo_id, device="cpu", compute_type="int8", local_files_only=True)
    except Exception:
        model = WhisperModel(repo_id, device="cpu", compute_type="int8")
    return model, "cpu"


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else "small"
    device_pref = sys.argv[2] if len(sys.argv) > 2 else "auto"

    try:
        model, active_device = load_model(model_name, device_pref)
    except Exception as exc:
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        sys.exit(1)

    print(json.dumps({"ready": True, "device": active_device, "model": model_name}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            wav_path = req["wav"]
            language = req.get("language") or None
            if language == "auto":
                language = None

            t0 = time.perf_counter()
            try:
                segments, info = model.transcribe(
                    wav_path,
                    language=language,
                    beam_size=1,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300},
                )
                text = " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()
            except Exception as exc:
                msg = str(exc).lower()
                if active_device == "cuda" and (
                    "cublas" in msg or "cudnn" in msg or "cuda" in msg or "lib" in msg
                ):
                    model, active_device = load_model(model_name, "cpu")
                    segments, info = model.transcribe(
                        wav_path,
                        language=language,
                        beam_size=1,
                        vad_filter=True,
                        vad_parameters={"min_silence_duration_ms": 300},
                    )
                    text = " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()
                else:
                    raise
            stt_ms = int((time.perf_counter() - t0) * 1000)

            print(
                json.dumps(
                    {
                        "ok": True,
                        "text": text,
                        "language": getattr(info, "language", language),
                        "stt_ms": stt_ms,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
