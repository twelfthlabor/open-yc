// Speaks posts with the browser's own speech engine (no key, nothing sent anywhere by default;
// some browsers use online voices, see the README) and takes dictation for replies.
import { NarrationQueue, type ListenMode } from "../../src/core/narrate.ts";
import type { Post } from "../../src/core/types.ts";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export class Narrator {
  readonly queue = new NarrationQueue();
  private enabled = false;
  private ctx: AudioContext | null = null;
  onSpeaking: (postId: string | null) => void = () => {};

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  // Must be called from a click: browsers only allow audio after a user gesture.
  enable(): void {
    this.enabled = true;
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {}
    this.pump();
  }

  disable(): void {
    this.enabled = false;
    this.queue.clear();
    if (this.supported) speechSynthesis.cancel();
    this.onSpeaking(null);
  }

  configure(mode: ListenMode, focus: string | null): void {
    this.queue.mode = mode;
    this.queue.focus = focus;
  }

  hear(post: Post, speaker: string): void {
    if (!this.enabled || !this.supported) return;
    const interrupt = this.queue.enqueue(post, speaker, Date.now());
    if (interrupt) {
      speechSynthesis.cancel(); // the cancelled utterance's onend calls pump()
      return;
    }
    if (!speechSynthesis.speaking) this.pump();
  }

  private chime(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.12);
      o.stop(now + i * 0.12 + 0.2);
    }
  }

  private pump = (): void => {
    if (!this.enabled || !this.supported || speechSynthesis.speaking) return;
    const u = this.queue.next(Date.now());
    if (!u) {
      this.onSpeaking(null);
      return;
    }
    if (u.priority === 0) this.chime();
    const utter = new SpeechSynthesisUtterance(u.text);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    // Each agent keeps the same voice and pitch, so you can tell them apart by ear.
    const h = hash(u.sessionId);
    if (voices.length) utter.voice = voices[h % voices.length];
    utter.pitch = 0.85 + (h % 5) * 0.08;
    utter.rate = 1.05;
    utter.onend = utter.onerror = () => {
      this.queue.finished();
      this.pump();
    };
    this.onSpeaking(u.postId);
    window.setTimeout(() => speechSynthesis.speak(utter), u.priority === 0 ? 320 : 0);
  };
}

type Recognizer = { start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null; interimResults: boolean; continuous: boolean; lang: string };

export function dictationSupported(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

// Starts dictation; calls onText with the running transcript. Returns a stop function.
export function dictate(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): () => void {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const r: Recognizer = new Ctor();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e: any) => {
    let text = "";
    let final = false;
    for (const res of e.results) {
      text += res[0].transcript;
      final = res.isFinal;
    }
    onText(text, final);
  };
  r.onerror = (e: any) => onEnd(e?.error ?? "dictation failed");
  r.onend = () => onEnd();
  r.start();
  return () => r.stop();
}
