import { pluck } from "./synth.js";

// A one-string slide guitar. Fretless on purpose: there is no wrong note to
// land on because there are no frets to miss, and a slide is the cheapest
// gesture that reads as expressive rather than as pressing buttons.

const MIN_HZ = 110; // A2
const MAX_HZ = 660; // E5, a little over two octaves
const GLIDE = 0.035; // portamento time constant, seconds

/** @typedef {{ ctx: AudioContext, master: GainNode }} Engine */

/** @type {Engine | null} */
let engine = null;
/** @type {AudioBufferSourceNode | null} */
let voice = null;
/** @type {GainNode | null} */
let voiceGain = null;
/** The pitch the ringing buffer was rendered at; the slide is relative to it. */
let rootHz = 220;
let currentHz = 220;

const string = /** @type {HTMLButtonElement} */ (document.querySelector("#string"));
const wire = /** @type {HTMLElement} */ (document.querySelector("#wire"));
const bottleneck = /** @type {HTMLElement} */ (document.querySelector("#bottleneck"));
const readout = /** @type {HTMLElement} */ (document.querySelector("#readout"));

/**
 * Build the context lazily and resume it here rather than on load. A fresh
 * AudioContext is suspended until a user gesture (the autoplay policy), and
 * since this runs inside the same gesture that asked for a note, the very
 * first pluck is audible instead of silently swallowed.
 * @returns {Engine}
 */
function audio() {
  if (!engine) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.7;
    // Cheap insurance: re-plucking over a ringing note stacks voices, and two
    // at full tilt is enough to clip the output.
    master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    engine = { ctx, master };
  }
  if (engine.ctx.state === "suspended") void engine.ctx.resume();
  return engine;
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Exponential, so a centimetre of travel is the same interval anywhere. */
function positionToHz(/** @type {number} */ t) {
  return MIN_HZ * (MAX_HZ / MIN_HZ) ** clamp(t, 0, 1);
}

function hzToPosition(/** @type {number} */ hz) {
  return Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
}

const NOTE_NAMES = ["A", "A♯", "B", "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯"];

/** @param {number} hz */
function noteName(hz) {
  const semitones = 12 * Math.log2(hz / 440);
  const nearest = Math.round(semitones);
  const cents = Math.round((semitones - nearest) * 100);
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12];
  const octave = 4 + Math.floor((nearest + 9) / 12);
  return `${name}${octave}${cents === 0 ? "" : cents > 0 ? ` +${cents}` : ` ${cents}`}`;
}

/** Damp whatever is ringing, the way a palm on the strings would. */
function damp(/** @type {number} */ seconds) {
  if (!engine || !voiceGain || !voice) return;
  const now = engine.ctx.currentTime;
  const dying = voice;
  voiceGain.gain.cancelScheduledValues(now);
  voiceGain.gain.setValueAtTime(voiceGain.gain.value, now);
  // Never ramp exponentially to 0 — the value has to stay positive or the call
  // throws and the note hangs forever.
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  dying.stop(now + seconds + 0.02);
  voice = null;
  voiceGain = null;
}

/**
 * @param {number} hz
 * @param {number} brightness
 */
function strike(hz, brightness) {
  const { ctx, master } = audio();
  damp(0.06);

  // Rendered at the pitch it is struck at, so playbackRate starts at 1 and the
  // slide only ever resamples by however far you actually travel.
  const samples = pluck(ctx.sampleRate, hz, { seconds: 3, brightness });
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);

  const gain = ctx.createGain();
  gain.gain.value = 0.9;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(master);
  source.start();
  source.addEventListener("ended", () => {
    if (voice === source) {
      voice = null;
      voiceGain = null;
    }
  });

  voice = source;
  voiceGain = gain;
  rootHz = hz;
  currentHz = hz;

  string.dataset.touched = "true";
  wire.classList.remove("plucked");
  void wire.offsetWidth; // restart the animation rather than let it queue
  wire.classList.add("plucked");
}

/** @param {number} hz */
function slideTo(hz) {
  currentHz = clamp(hz, MIN_HZ, MAX_HZ);
  if (!engine || !voice) return;
  voice.playbackRate.setTargetAtTime(currentHz / rootHz, engine.ctx.currentTime, GLIDE);
}

function render() {
  bottleneck.style.setProperty("--at", hzToPosition(currentHz).toFixed(4));
  readout.textContent = noteName(currentHz);
}

/** @param {PointerEvent} event */
function readPointer(event) {
  const box = string.getBoundingClientRect();
  return {
    hz: positionToHz((event.clientX - box.left) / box.width),
    // Vertical position is where you pick: the top edge is at the bridge,
    // thin and bright; the bottom is over the neck, dark and round. It is
    // baked into the note at the moment of the pluck, so sliding afterwards
    // moves the pitch and leaves the colour alone — same as a real string.
    brightness: 0.12 + 0.8 * (1 - clamp((event.clientY - box.top) / box.height, 0, 1)),
  };
}

string.addEventListener("pointerdown", (event) => {
  string.setPointerCapture(event.pointerId);
  const { hz, brightness } = readPointer(event);
  strike(hz, brightness);
  render();
});

string.addEventListener("pointermove", (event) => {
  if (!string.hasPointerCapture(event.pointerId)) return;
  slideTo(readPointer(event).hz);
  render();
});

for (const type of ["pointerup", "pointercancel"]) {
  string.addEventListener(type, (event) => {
    string.releasePointerCapture(/** @type {PointerEvent} */ (event).pointerId);
  });
}

// Keyboard players get the same instrument: Enter or Space plucks, the arrows
// are the slide. `detail === 0` is how a keyboard-activated click announces
// itself — without the guard a mouse click would pluck twice, once here and
// once from pointerdown.
string.addEventListener("click", (event) => {
  if (event.detail !== 0) return;
  strike(currentHz, 0.6);
  render();
});

string.addEventListener("keydown", (event) => {
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (direction === 0) return;
  event.preventDefault();
  slideTo(currentHz * 2 ** ((direction * (event.shiftKey ? 1 : 2)) / 12));
  render();
});

render();
