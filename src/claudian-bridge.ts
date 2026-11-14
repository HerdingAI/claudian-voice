import { setIcon } from "obsidian";
import { VoiceState } from "./types";

export interface PanelCallbacks {
  onTogglePushToTalk: (panel: HTMLElement) => void;
  onToggleHandsFree: (panel: HTMLElement) => void;
  onStopSpeaking: () => void;
}

export interface ReplyWatcherCallbacks {
  skipCodeBlocks: boolean;
  onSentence: (sentence: string) => void;
  onComplete: () => void;
}

function extractSpokenText(
  messageEl: HTMLElement,
  skipCodeBlocks: boolean
): string {
  const blocks = messageEl.querySelectorAll(
    ":scope > .claudian-message-content > .claudian-text-block"
  );
  const parts: string[] = [];

  blocks.forEach((block) => {
    if (block.querySelector(".claudian-interrupted")) return;
    const clone = block.cloneNode(true) as HTMLElement;
    if (skipCodeBlocks) {
      clone.querySelectorAll("pre").forEach((el) => {
        el.replaceWith(" (code block omitted) ");
      });
    }
    const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  });

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Splits `text` starting at `cursor` into complete sentences, returning
 * `[sentences, newCursor]`. Leaves any incomplete trailing fragment after
 * `newCursor` so it can grow during streaming.
 */
export function extractCompletedSentences(
  text: string,
  cursor: number
): { sentences: string[]; nextCursor: number } {
  const slice = text.slice(cursor);
  if (!slice) return { sentences: [], nextCursor: cursor };

  const sentences: string[] = [];
  const re = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = re.exec(slice)) !== null) {
    const chunk = match[0];
    const endsWithPunct = /[.!?]$/.test(chunk.trim());
    const isAtEnd = match.index + chunk.length === slice.length;

    // Only emit if it ends with sentence punctuation AND either isn't at the very
    // end of the buffer or has trailing whitespace (avoid splitting "3.14" mid-stream).
    if (endsWithPunct && !isAtEnd) {
      const cleaned = chunk.trim();
      if (cleaned) sentences.push(cleaned);
      consumed = match.index + chunk.length;
    } else if (!isAtEnd) {
      // Shouldn't happen often, advance consumed
      consumed = match.index + chunk.length;
    } else {
      break;
    }
  }

  return { sentences, nextCursor: cursor + consumed };
}

export class ClaudianDomBridge {
  private domObserver: MutationObserver | null = null;
  private replyObserver: MutationObserver | null = null;
  private controlsByPanel = new Map<
    HTMLElement,
    {
      root: HTMLElement;
      micBtn: HTMLButtonElement;
      handsFreeBtn: HTMLButtonElement;
      stopBtn: HTMLButtonElement;
      statusEl: HTMLElement;
    }
  >();

  constructor(private callbacks: PanelCallbacks) {}

  start(): void {
    this.scanPanels();
    this.domObserver = new MutationObserver(() => {
      this.scanPanels();
    });
    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  stop(): void {
    this.domObserver?.disconnect();
    this.domObserver = null;
    this.stopWatchingReply();
    for (const entry of this.controlsByPanel.values()) {
      entry.root.remove();
    }
    this.controlsByPanel.clear();
  }

  scanPanels(): void {
    const panels = document.querySelectorAll<HTMLElement>(".claudian-chat-panel");
    panels.forEach((panel) => {
      const toolbar = panel.querySelector<HTMLElement>(
        ".claudian-input-toolbar"
      );
      if (!toolbar) return;
      if (toolbar.querySelector('[data-claudian-voice="1"]')) return;

      const root = document.createElement("div");
      root.className = "claudian-voice-controls";
      root.setAttribute("data-claudian-voice", "1");

      const micBtn = document.createElement("button");
      micBtn.type = "button";
      micBtn.className = "claudian-voice-btn claudian-voice-mic";
      micBtn.setAttribute("aria-label", "Push-to-Talk (Claudian Voice)");
      micBtn.title = "Push-to-Talk: click to record, click again to send";
      setIcon(micBtn, "mic");
      micBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTogglePushToTalk(panel);
      });

      const handsFreeBtn = document.createElement("button");
      handsFreeBtn.type = "button";
      handsFreeBtn.className = "claudian-voice-btn claudian-voice-handsfree";
      handsFreeBtn.setAttribute(
        "aria-label",
        "Hands-Free Voice Conversation"
      );
      handsFreeBtn.title = "Hands-Free: continuous back-and-forth voice chat";
      setIcon(handsFreeBtn, "audio-lines");
      handsFreeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onToggleHandsFree(panel);
      });

      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "claudian-voice-btn claudian-voice-stop is-hidden";
      stopBtn.setAttribute("aria-label", "Stop Speaking");
      stopBtn.title = "Stop speaking";
      setIcon(stopBtn, "volume-x");
      stopBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onStopSpeaking();
      });

      const statusEl = document.createElement("span");
      statusEl.className = "claudian-voice-status is-hidden";

      root.appendChild(micBtn);
      root.appendChild(handsFreeBtn);
      root.appendChild(stopBtn);
      root.appendChild(statusEl);
      toolbar.appendChild(root);

      this.controlsByPanel.set(panel, {
        root,
        micBtn,
        handsFreeBtn,
        stopBtn,
        statusEl,
      });
    });

    // Prune detached panels
    for (const [panel, entry] of this.controlsByPanel.entries()) {
      if (!document.body.contains(panel)) {
        entry.root.remove();
        this.controlsByPanel.delete(panel);
      }
    }
  }

  getActivePanel(): HTMLElement | null {
    const active = document.activeElement as HTMLElement | null;
    const fromFocus = active?.closest<HTMLElement>(".claudian-chat-panel");
    if (fromFocus) return fromFocus;

    const panels = Array.from(
      document.querySelectorAll<HTMLElement>(".claudian-chat-panel")
    );
    return (
      panels.find((p) => p.offsetParent !== null) ??
      panels[0] ??
      null
    );
  }

  updateUiState(
    state: VoiceState,
    handsFreeActive: boolean,
    speaking: boolean,
    label?: string
  ): void {
    for (const entry of this.controlsByPanel.values()) {
      entry.micBtn.classList.toggle("is-recording", state === "recording");
      entry.micBtn.classList.toggle(
        "is-transcribing",
        state === "transcribing"
      );
      entry.handsFreeBtn.classList.toggle("is-active", handsFreeActive);
      entry.handsFreeBtn.classList.toggle(
        "is-listening",
        handsFreeActive && state === "listening"
      );
      entry.stopBtn.classList.toggle("is-hidden", !speaking);

      const statusText =
        label ??
        (state === "recording"
          ? "Listening..."
          : state === "transcribing"
          ? "Transcribing..."
          : state === "thinking"
          ? "Thinking..."
          : state === "speaking"
          ? "Speaking..."
          : handsFreeActive
          ? "Voice ready"
          : "");

      entry.statusEl.textContent = statusText;
      entry.statusEl.classList.toggle("is-hidden", !statusText);
    }
  }

  submitText(panel: HTMLElement, text: string, autoSubmit: boolean): boolean {
    const composer = panel.querySelector<HTMLElement>(".claudian-composer-editor");
    if (!composer) return false;

    if (!composer.querySelector(".cm-content")) {
      composer.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }

    const target =
      composer.querySelector<HTMLElement>(".cm-content") ?? composer;

    target.focus();

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      target.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        })
      );
    }

    if (autoSubmit) {
      window.setTimeout(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      }, 80);
    }
    return true;
  }

  watchNextAssistantReply(
    panel: HTMLElement,
    callbacks: ReplyWatcherCallbacks
  ): void {
    this.stopWatchingReply();

    const messagesEl = panel.querySelector<HTMLElement>(".claudian-messages");
    if (!messagesEl) {
      callbacks.onComplete();
      return;
    }

    const initialCount = messagesEl.querySelectorAll(
      ".claudian-message-assistant"
    ).length;

    let trackedMsg: HTMLElement | null = null;
    let spokenCursor = 0;
    let finished = false;
    let idleTimer: number | null = null;

    const finalize = () => {
      if (finished) return;
      finished = true;
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      this.stopWatchingReply();

      if (trackedMsg) {
        const fullText = extractSpokenText(trackedMsg, callbacks.skipCodeBlocks);
        const remainder = fullText.slice(spokenCursor).trim();
        if (remainder) {
          callbacks.onSentence(remainder);
        }
      }
      callbacks.onComplete();
    };

    const inspect = () => {
      if (finished) return;
      const assistants = messagesEl.querySelectorAll<HTMLElement>(
        ".claudian-message-assistant"
      );
      if (!trackedMsg && assistants.length > initialCount) {
        trackedMsg = assistants[assistants.length - 1];
      }
      if (!trackedMsg) return;

      const fullText = extractSpokenText(trackedMsg, callbacks.skipCodeBlocks);
      const { sentences, nextCursor } = extractCompletedSentences(
        fullText,
        spokenCursor
      );
      spokenCursor = nextCursor;
      for (const s of sentences) {
        callbacks.onSentence(s);
      }

      // Claudian appends timestamp / throughput / message-actions when the turn completes
      if (
        trackedMsg.querySelector(
          ".claudian-message-timestamp, .claudian-response-throughput, .claudian-message-actions"
        )
      ) {
        finalize();
        return;
      }

      // Safety fallback: if no DOM changes for 30s after text started, finalize
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (!finished && trackedMsg) {
          finalize();
        }
      }, 30000);
    };

    this.replyObserver = new MutationObserver(() => inspect());
    this.replyObserver.observe(messagesEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Run once immediately in case the reply already started
    inspect();
  }

  stopWatchingReply(): void {
    this.replyObserver?.disconnect();
    this.replyObserver = null;
  }
}
