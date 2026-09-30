/**
 * Sound effects, synthesised at runtime.
 *
 * There are no audio files in this repo on purpose: shipping placeholder sound
 * would mean shipping someone else's, and generating tones from an oscillator
 * costs nothing, adds no assets and is trivially replaceable later - swap the
 * body of each `play*` for a buffer lookup and the call sites do not change.
 *
 * Autoplay policy is respected rather than worked around: no `AudioContext` is
 * created until a real user gesture, and every method is a no-op before then.
 */

export type BuiltinVoice =
  "join" | "ready" | "tick" | "accept" | "reject" | "explode" | "score" | "win" | "start";

/** A built-in voice, or one a game registered with `sfx.define()`. */
export type Voice = BuiltinVoice | (string & {});

/** Synthesises one cue. Runs only after the engine is unlocked. */
export type VoicePlayer = (ctx: AudioContext, master: GainNode) => void;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private musicGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private custom = new Map<string, VoicePlayer>();

  /**
   * Registers a game's own cue, or replaces a built-in one. The player gets
   * the audio context and the master gain; it may synthesise or play a buffer.
   */
  define(voice: string, player: VoicePlayer): void {
    this.custom.set(voice, player);
  }

  /**
   * Creates the audio graph. Must be called from inside a user-gesture handler;
   * calling it anywhere else leaves audio silent, which is the correct
   * behaviour rather than an error.
   */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.35 : 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isReady(): boolean {
    return this.ctx !== null;
  }

  play(voice: Voice): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const custom = this.custom.get(voice);
    if (custom) {
      try {
        custom(this.ctx, this.master);
      } catch {
        /* a broken cue must not break play */
      }
      return;
    }
    switch (voice) {
      case "join":
        this.blip([440, 660], 0.09, "triangle");
        return;
      case "ready":
        this.blip([660, 880], 0.07, "square", 0.18);
        return;
      case "start":
        this.blip([392, 523, 659, 784], 0.11, "triangle");
        return;
      case "tick":
        this.blip([1400], 0.03, "square", 0.12);
        return;
      case "accept":
        this.blip([784, 1046], 0.07, "triangle");
        return;
      case "reject":
        this.blip([196, 165], 0.12, "sawtooth", 0.2);
        return;
      case "score":
        this.blip([523, 659, 880], 0.06, "sine");
        return;
      case "win":
        this.blip([523, 659, 784, 1046, 1318], 0.13, "triangle");
        return;
      case "explode":
        this.noiseBurst(0.55);
        return;
    }
  }

  /** Plays a short sequence of tones, one after another. */
  private blip(
    frequencies: number[],
    stepSeconds: number,
    type: OscillatorType,
    gain = 0.25,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    frequencies.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const start = ctx.currentTime + index * stepSeconds;
      const end = start + stepSeconds * 1.6;

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, start);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    });
  }

  /** Filtered white noise with a fast attack: a serviceable explosion. */
  private noiseBurst(seconds: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const frames = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + seconds);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.9, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);

    source.connect(filter);
    filter.connect(env);
    env.connect(master);
    source.start();
  }

  /**
   * A sparse two-note bass pulse for the lobby.
   *
   * Deliberately minimal: background music on a shared screen competes with
   * people talking, which is the actual point of a party game.
   */
  startMusic(): void {
    if (!this.ctx || !this.master || this.musicTimer) return;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.08;
    this.musicGain.connect(this.master);

    const notes = [110, 110, 146.83, 130.81];
    let step = 0;
    this.musicTimer = setInterval(() => {
      const ctx = this.ctx;
      const out = this.musicGain;
      if (!ctx || !out || !this.enabled) return;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = notes[step % notes.length] ?? 110;
      env.gain.setValueAtTime(0.0001, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(env);
      env.connect(out);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
      step += 1;
    }, 600);
  }

  stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicGain?.disconnect();
    this.musicGain = null;
  }
}

export const sfx = new SoundEngine();

/**
 * Short vibration, where the device and browser support it.
 *
 * iOS Safari does not implement the Vibration API at all, so this is strictly a
 * bonus: no interaction may depend on it being felt.
 */
export function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
