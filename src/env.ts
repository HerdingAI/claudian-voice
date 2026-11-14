import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function buildCleanEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraBins = [
    path.join(home, ".local", "bin"),
    path.join(home, ".venvs", "audio", "bin"),
    path.join(home, ".cache", "obsidian-read-aloud", "venv", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const currentPath = (process.env.PATH || "")
    .split(path.delimiter)
    .filter((p) => p && !p.startsWith("/snap/"));
  const dedupedPath = Array.from(new Set([...extraBins, ...currentPath])).join(
    path.delimiter
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: dedupedPath,
    PYTHONUNBUFFERED: "1",
  };

  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  if (env.LD_LIBRARY_PATH) {
    const cleaned = env.LD_LIBRARY_PATH.split(path.delimiter)
      .filter((p) => p && !p.startsWith("/snap/"))
      .join(path.delimiter);
    if (cleaned) {
      env.LD_LIBRARY_PATH = cleaned;
    } else {
      delete env.LD_LIBRARY_PATH;
    }
  }

  return env;
}

export function resolveSttPython(overridePath: string): string {
  const trimmed = overridePath.trim();
  if (trimmed) return trimmed;

  const home = os.homedir();
  const candidates = [
    path.join(home, ".venvs", "audio", "bin", "python3"),
    path.join(home, ".obsidian-audio-transcriber-venv", "bin", "python3"),
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return "python3";
}

export function getKokoroPaths() {
  const root = path.join(os.homedir(), ".cache", "obsidian-read-aloud");
  const pythonPath = path.join(root, "venv", "bin", "python");
  const modelPath = path.join(root, "models", "kokoro", "kokoro-v1.0.int8.onnx");
  const voicesPath = path.join(root, "models", "kokoro", "voices-v1.0.bin");
  const workerPath = path.join(root, "kokoro_worker.py");
  const installed =
    fs.existsSync(pythonPath) &&
    fs.existsSync(modelPath) &&
    fs.existsSync(voicesPath) &&
    fs.existsSync(workerPath);
  return { installed, pythonPath, modelPath, voicesPath, workerPath };
}
