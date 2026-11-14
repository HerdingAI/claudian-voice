import { App, PluginSettingTab, Setting } from "obsidian";
import { getKokoroPaths } from "./env";
import type ClaudianVoicePlugin from "./main";
import { KOKORO_VOICES, WHISPER_MODELS } from "./types";

export class ClaudianVoiceSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ClaudianVoicePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claudian Voice" });

    const kokoro = getKokoroPaths();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: kokoro.installed
        ? "Local Kokoro TTS detected (~/.cache/obsidian-read-aloud). Local Whisper STT uses ~/.venvs/audio."
        : "Kokoro TTS not found in ~/.cache/obsidian-read-aloud; Web Speech fallback will be used.",
    });

    containerEl.createEl("h3", { text: "Speech-to-Text (Whisper)" });

    new Setting(containerEl)
      .setName("Whisper model")
      .setDesc("Local faster-whisper model for voice input.")
      .addDropdown((dd) => {
        for (const m of WHISPER_MODELS) dd.addOption(m.id, m.label);
        dd.setValue(this.plugin.settings.sttModel).onChange(async (val) => {
          this.plugin.settings.sttModel = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Compute device")
      .setDesc("CUDA GPU (auto-fallback to CPU) or force CPU.")
      .addDropdown((dd) => {
        dd.addOption("auto", "Auto (CUDA if available)");
        dd.addOption("cuda", "NVIDIA CUDA");
        dd.addOption("cpu", "CPU");
        dd.setValue(this.plugin.settings.sttDevice).onChange(async (val) => {
          this.plugin.settings.sttDevice = val as "auto" | "cuda" | "cpu";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Language")
      .setDesc("ISO language code (e.g. en, es) or 'auto' for auto-detect.")
      .addText((txt) =>
        txt
          .setPlaceholder("en")
          .setValue(this.plugin.settings.sttLanguage)
          .onChange(async (val) => {
            this.plugin.settings.sttLanguage = val.trim() || "en";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Text-to-Speech (Replies)" });

    new Setting(containerEl)
      .setName("TTS engine")
      .addDropdown((dd) => {
        dd.addOption("kokoro", "Kokoro (Local GPU/ONNX)");
        dd.addOption("webspeech", "Browser Web Speech");
        dd.setValue(this.plugin.settings.ttsEngine).onChange(async (val) => {
          this.plugin.settings.ttsEngine = val as "kokoro" | "webspeech";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Kokoro voice")
      .addDropdown((dd) => {
        for (const v of KOKORO_VOICES) dd.addOption(v.id, v.label);
        dd.setValue(this.plugin.settings.kokoroVoice).onChange(async (val) => {
          this.plugin.settings.kokoroVoice = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Speech speed")
      .setDesc("Playback speed multiplier (0.75 to 1.5).")
      .addSlider((sl) =>
        sl
          .setLimits(0.75, 1.5, 0.05)
          .setValue(this.plugin.settings.speechRate)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.speechRate = val;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Conversation & Hands-Free VAD" });

    new Setting(containerEl)
      .setName("Auto-submit after transcription")
      .setDesc("Automatically press Enter in Claudian after transcribing speech.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.autoSubmit)
          .onChange(async (val) => {
            this.plugin.settings.autoSubmit = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-speak Claudian replies")
      .setDesc("Read Claudian's responses aloud after voice prompts.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.autoSpeakReplies)
          .onChange(async (val) => {
            this.plugin.settings.autoSpeakReplies = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Skip code blocks when speaking")
      .setDesc("Replace fenced code blocks with '(code block omitted)' in TTS.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.skipCodeBlocksInSpeech)
          .onChange(async (val) => {
            this.plugin.settings.skipCodeBlocksInSpeech = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Silence timeout (ms)")
      .setDesc("How long to wait after you stop speaking in hands-free mode.")
      .addSlider((sl) =>
        sl
          .setLimits(500, 2500, 100)
          .setValue(this.plugin.settings.vadSilenceMs)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.vadSilenceMs = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mic sensitivity (VAD RMS threshold)")
      .setDesc("Lower = more sensitive; raise if background noise triggers recording.")
      .addSlider((sl) =>
        sl
          .setLimits(0.005, 0.06, 0.002)
          .setValue(this.plugin.settings.vadThreshold)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.vadThreshold = val;
            await this.plugin.saveSettings();
          })
      );
  }
}
