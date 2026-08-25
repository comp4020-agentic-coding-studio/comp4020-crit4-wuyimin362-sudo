import { describe, expect, it } from "vitest";
import { pluck } from "../synth.js";

// Nobody in this loop can hear the output — not the agent that wrote the
// synthesis code, not CI. So the things an ear would catch immediately
// (silence, the wrong note, a tone that never dies, digital clipping) get
// caught arithmetically instead. This is the sensor standing in for an ear;
// it is not a substitute for actually listening, and the brief says so.

const SR = 48_000;

/** Deterministic RNG, so a failure here is always the same failure. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rms(signal: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / (to - from));
}

/**
 * Estimate the fundamental by autocorrelation. Takes the *shortest* lag whose
 * correlation is within 10% of the best, because a periodic signal correlates
 * just as happily at twice its period and would otherwise report an octave
 * down.
 */
function fundamentalHz(signal: Float32Array, sampleRate: number): number {
  const window = signal.subarray(0, Math.floor(sampleRate * 0.25));
  const minLag = Math.floor(sampleRate / 2000);
  const maxLag = Math.ceil(sampleRate / 50);
  const scores: number[] = [];
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < window.length; i++) sum += window[i] * window[i + lag];
    const score = sum / (window.length - lag);
    scores[lag] = score;
    if (score > best) best = score;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag] >= best * 0.9) return sampleRate / lag;
  }
  return sampleRate / minLag;
}

describe("the string makes a sound", () => {
  const note = pluck(SR, 220, { random: seeded(1) });

  it("is not silent", () => {
    let peak = 0;
    for (const sample of note) peak = Math.max(peak, Math.abs(sample));
    expect(peak, "the buffer is silent — this would ship a mute instrument").toBeGreaterThan(0.05);
  });

  it("emits only finite samples", () => {
    let bad = 0;
    for (const sample of note) if (!Number.isFinite(sample)) bad++;
    expect(bad, "NaN or Infinity in the buffer renders as a click, or as nothing").toBe(0);
  });

  it("stays inside -1..1", () => {
    let peak = 0;
    for (const sample of note) peak = Math.max(peak, Math.abs(sample));
    expect(peak, "samples past full scale clip, and clipping sounds like a fault").toBeLessThanOrEqual(1);
  });
});

describe("the string is in tune", () => {
  // Two octaves of the range the slide actually covers.
  for (const hz of [110, 220, 440]) {
    it(`plucked at ${hz}Hz, reads back as ${hz}Hz`, () => {
      const measured = fundamentalHz(pluck(SR, hz, { random: seeded(hz) }), SR);
      // 1.5% is a quarter-tone-ish: enough slack for the delay line rounding
      // to whole samples, tight enough to catch an octave or a scale error.
      expect(Math.abs(measured - hz) / hz).toBeLessThan(0.015);
    });
  }
});

describe("the string dies away", () => {
  const note = pluck(SR, 220, { seconds: 3, random: seeded(2) });

  it("is much quieter at the end than at the start", () => {
    const opening = rms(note, 0, SR * 0.1);
    const ending = rms(note, note.length - SR * 0.1, note.length);
    expect(
      ending,
      "a note that never decays is a drone, not a pluck — check `sustain`",
    ).toBeLessThan(opening * 0.5);
  });
});

describe("pick position changes the colour, not the volume", () => {
  const bridge = pluck(SR, 220, { brightness: 0.95, random: seeded(3) });
  const neck = pluck(SR, 220, { brightness: 0.08, random: seeded(3) });

  /** Zero crossings over the first 50ms — a cheap proxy for high-frequency energy. */
  function crossings(signal: Float32Array): number {
    let count = 0;
    for (let i = 1; i < SR * 0.05; i++) {
      if (signal[i - 1] < 0 !== signal[i] < 0) count++;
    }
    return count;
  }

  it("is brighter at the bridge than over the neck", () => {
    expect(
      crossings(bridge),
      "brightness does nothing — the one expressive control is inert",
    ).toBeGreaterThan(crossings(neck));
  });

  it("is not appreciably louder at the bridge", () => {
    const ratio = rms(bridge, 0, SR * 0.1) / rms(neck, 0, SR * 0.1);
    expect(
      ratio,
      "pick position is changing loudness, so it reads as a volume knob",
    ).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
