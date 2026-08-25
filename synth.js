// Karplus-Strong plucked string, as plain numbers.
//
// Deliberately free of Web Audio: this is the part that decides whether the
// instrument makes a sound at all, and keeping it a pure function is what lets
// spec/synth.test.ts check the pitch, the decay and the timbre in node. An
// AudioContext can only be heard, and nobody can hear a test run.

/**
 * Synthesise one plucked note.
 *
 * @param {number} sampleRate
 * @param {number} freq fundamental, Hz
 * @param {object} [options]
 * @param {number} [options.seconds] length of the rendered note
 * @param {number} [options.brightness] 0..1 tone of the excitation: 1 keeps the
 *   noise intact, 0 filters it down to a dull thud
 * @param {number} [options.sustain] 0..1 feedback gain, one trip round the loop
 * @param {number} [options.pick] 0..0.5 where along the string it was plucked,
 *   as a fraction of its length. 0 disables the model.
 * @param {() => number} [options.random] injectable RNG, so tests are repeatable
 * @returns {Float32Array<ArrayBuffer>} mono samples in -1..1. The buffer type
 *   is pinned because `AudioBuffer.copyToChannel` refuses a possibly-shared one.
 */
export function pluck(sampleRate, freq, options = {}) {
  const {
    seconds = 3,
    brightness = 0.5,
    sustain = 0.996,
    pick = 0,
    random = Math.random,
  } = options;

  // The delay line is one period long, so its length *is* the pitch. Rounding
  // to whole samples quantises the tuning slightly; above ~2kHz the error gets
  // audible, which is why this instrument stops well short of that.
  const period = Math.max(2, Math.round(sampleRate / freq));
  const length = Math.max(period, Math.floor(sampleRate * seconds));
  const out = new Float32Array(length);

  // The pluck itself: a burst of noise one period long, run through a one-pole
  // lowpass. How much of the noise survives is where along the string you
  // picked it.
  let lp = 0;
  for (let i = 0; i < period; i++) {
    lp += brightness * (random() * 2 - 1 - lp);
    out[i] = lp;
  }

  // Where you picked it. A string plucked a third of the way along can't
  // vibrate in any mode with a node at that point, so every third harmonic is
  // missing — subtracting a delayed copy of the excitation puts exactly those
  // notches in. This is most of the difference between a bridge pluck and a
  // neck one, and it is the part a plain lowpass can't fake.
  if (pick > 0) {
    const offset = Math.max(1, Math.round(period * Math.min(0.5, pick)));
    // Backwards, so each sample is combed against the untouched original.
    for (let i = period - 1; i >= offset; i--) out[i] -= out[i - offset];
  }

  // Normalise the excitation so pick position changes the colour of the note
  // and not its volume.
  let peak = 0;
  for (let i = 0; i < period; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    for (let i = 0; i < period; i++) out[i] /= peak;
  }

  // The string: feed the delay line back into itself through a two-point
  // average. The average is a lowpass, so every trip round the loop loses the
  // top harmonics first — the note gets rounder as it dies, the way a real
  // string does. That decay is the whole reason this sounds plucked instead of
  // like a test tone.
  for (let i = period; i < length; i++) {
    out[i] = sustain * 0.5 * (out[i - period] + out[i - period + 1]);
  }

  return out;
}
