import { Notice, Plugin } from "obsidian";
import * as path from "path";
import { VoiceAudioCapture } from "./audio-recorder";
import { ClaudianDomBridge } from "./claudian-bridge";
import { ClaudianVoiceSettingTab } from "./settings";
import { SttWorkerClient } from "./stt-worker";
import { TtsSpeaker } from "./tts-worker";
import { ClaudianVoiceSettings, DEFAULT_SETTINGS, VoiceState } from "./types";

export default class ClaudianVoicePlugin extends Plugin {
  settings: ClaudianVoiceSettings = { ...DEFAULT_SETTINGS };

  private state: VoiceState = "idle";
  private handsFreeActive = false;
  private replyDone = true;

  private capture!: VoiceAudioCapture;
  private stt!: SttWorkerClient;
  private tts!: TtsSpeaker;
  private bridge!: ClaudianDomBridge;

  async onload(): Promise<void> {
    await this.loadSettings();

    const pluginDir = path.join(
      (this.app.vault.adapter as unknown as { basePath: string }).basePath,
      this.app.vault.configDir,
      "plugins",
      this.manifest.id
    );

    this.capture = new VoiceAudioCapture(() => this.settings);
    this.stt = new SttWorkerClient(pluginDir, () => this.settings);
    this.tts = new TtsSpeaker(() => this.settings);

    this.tts.onSpeakingChange = (speaking) => {
      if (speaking) {
        this.setState("speaking");
      } else {
        this.maybeResumeAfterTurn();
      }
    };

    this.bridge = new ClaudianDomBridge({
      onTogglePushToTalk: (panel) => void this.togglePushToTalk(panel),
      onToggleHandsFree: (panel) => void this.toggleHandsFree(panel),
      onStopSpeaking: () => this.stopSpeaking(),
    });

    this.addSettingTab(new ClaudianVoiceSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-push-to-talk",
      name: "Toggle Push-to-Talk for Claudian",
      callback: () => {
        const panel = this.bridge.getActivePanel();
        if (!panel) {
          new Notice("Open a Claudian chat panel first.");
          return;
        }
        void this.togglePushToTalk(panel);
      },
    });

    this.addCommand({
      id: "toggle-hands-free",
      name: "Toggle Hands-Free Voice Conversation for Claudian",
      callback: () => {
        const panel = this.bridge.getActivePanel();
        if (!panel) {
          new Notice("Open a Claudian chat panel first.");
          return;
        }
        void this.toggleHandsFree(panel);
      },
    });

    this.addCommand({
      id: "stop-speaking",
      name: "Stop Claudian Voice playback",
      callback: () => this.stopSpeaking(),
    });

    this.app.workspace.onLayoutReady(() => {
      this.bridge.start();
    });
    if (this.app.workspace.layoutReady) {
      this.bridge.start();
    }
  }

  onunload(): void {
    this.handsFreeActive = false;
    this.bridge?.stop();
    this.capture?.dispose();
    this.tts?.dispose();
    this.stt?.dispose();
  }

  private setState(state: VoiceState, label?: string): void {
    this.state = state;
    this.bridge?.updateUiState(
      state,
      this.handsFreeActive,
      this.tts?.speaking ?? false,
      label
    );
  }

  private maybeResumeAfterTurn(): void {
    if (!this.replyDone || this.tts.speaking) return;

    if (this.handsFreeActive) {
      this.capture.resumeVad();
      this.setState("listening");
    } else if (this.state !== "recording" && this.state !== "transcribing") {
      this.setState("idle");
    }
  }

  private stopSpeaking(): void {
    this.tts.stop();
    this.bridge.stopWatchingReply();
    this.replyDone = true;
    this.maybeResumeAfterTurn();
  }

  private async togglePushToTalk(panel: HTMLElement): Promise<void> {
    if (this.handsFreeActive) {
      this.stopHandsFree();
    }

    if (this.tts.speaking) {
      this.stopSpeaking();
    }

    if (this.state === "recording") {
      const wav = this.capture.stopPushToTalk();
      if (!wav) {
        this.setState("idle");
        return;
      }
      await this.processUtterance(panel, wav);
      return;
    }

    if (this.state === "transcribing") return;

    try {
      this.setState("recording");
      await this.capture.startPushToTalk();
    } catch (err) {
      this.setState("idle");
      new Notice(
        `Microphone error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async toggleHandsFree(panel: HTMLElement): Promise<void> {
    if (this.handsFreeActive) {
      this.stopHandsFree();
      return;
    }

    this.handsFreeActive = true;
    this.replyDone = true;
    this.setState("listening");

    try {
      await this.capture.startVad({
        onSpeechStart: () => {
          if (this.tts.speaking) {
            this.stopSpeaking();
          }
          this.setState("recording");
        },
        onUtterance: (wav) => {
          void this.handleVadUtterance(panel, wav);
        },
      });
      new Notice("Claudian Voice: Hands-free mode active");
    } catch (err) {
      this.handsFreeActive = false;
      this.setState("idle");
      new Notice(
        `Microphone error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private stopHandsFree(): void {
    this.handsFreeActive = false;
    this.capture.stopVad();
    this.tts.stop();
    this.bridge.stopWatchingReply();
    this.replyDone = true;
    this.setState("idle");
  }

  private async handleVadUtterance(
    panel: HTMLElement,
    wav: ArrayBuffer
  ): Promise<void> {
    if (!this.handsFreeActive) return;
    this.capture.pauseVad();
    await this.processUtterance(panel, wav);
  }

  private async processUtterance(
    panel: HTMLElement,
    wav: ArrayBuffer
  ): Promise<void> {
    this.setState("transcribing");
    try {
      const res = await this.stt.transcribeWavBytes(wav);
      if (!res.text) {
        this.replyDone = true;
        this.maybeResumeAfterTurn();
        return;
      }

      const ok = this.bridge.submitText(panel, res.text, this.settings.autoSubmit);
      if (!ok) {
        new Notice("Could not find Claudian composer input.");
        this.replyDone = true;
        this.maybeResumeAfterTurn();
        return;
      }

      if (this.settings.autoSubmit && this.settings.autoSpeakReplies) {
        this.replyDone = false;
        this.setState("thinking");
        this.bridge.watchNextAssistantReply(panel, {
          skipCodeBlocks: this.settings.skipCodeBlocksInSpeech,
          onSentence: (sentence) => {
            this.tts.enqueue(sentence);
          },
          onComplete: () => {
            this.replyDone = true;
            this.maybeResumeAfterTurn();
          },
        });
      } else {
        this.replyDone = true;
        this.maybeResumeAfterTurn();
      }
    } catch (err) {
      console.error("[claudian-voice] STT error:", err);
      new Notice(
        `Transcription error: ${err instanceof Error ? err.message : String(err)}`
      );
      this.replyDone = true;
      this.maybeResumeAfterTurn();
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
