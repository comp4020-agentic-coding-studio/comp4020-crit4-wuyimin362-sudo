import { pluck } from "./synth.js";

// An acoustic guitar. Six independent strings in standard tuning, strummed by
// dragging across them, fretted by pressing the neck, and tuned by turning the
// pegs on the headstock — which slacken and tighten the string, so they move
// the pitch and the colour together the way real tension does.

// --- geometry -------------------------------------------------------------
// These mirror the SVG in index.html. .stage is locked to the viewBox aspect
// ratio, so a pointer position converts to viewBox units by simple scaling.
const VIEW_W = 200;
const VIEW_H = 430;
const NUT_Y = 78;
const BRIDGE_Y = 375;
const SCALE = BRIDGE_Y - NUT_Y;
const BOARD_END = 232;
const FRETS = 12;

const NUT_X = [70, 82, 94, 106, 118, 130];
const BRIDGE_X = [64, 78.4, 92.8, 107.2, 121.6, 136];
const POST = [
  [80, 20],
  [80, 40],
  [80, 60],
  [120, 60],
  [120, 40],
  [120, 20],
];

/**
 * Rule of 18: fret n sits at scale × (1 − 2^(−n/12)) from the nut.
 * @param {number} n
 */
function fretY(n) {
  return NUT_Y + SCALE * (1 - 2 ** (-n / 12));
}

/**
 * Where string `i` crosses height `y`. Strings fan out toward the bridge.
 * @param {number} i
 * @param {number} y
 */
function stringX(i, y) {
  const t = (y - NUT_Y) / SCALE;
  return NUT_X[i] + (BRIDGE_X[i] - NUT_X[i]) * t;
}

/**
 * Fractional string index under a point — 0 is the low E, 5 the high E.
 * @param {number} x
 * @param {number} y
 */
function stringIndexAt(x, y) {
  const left = stringX(0, y);
  const right = stringX(5, y);
  return ((x - left) / (right - left)) * 5;
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// --- the strings ----------------------------------------------------------
// Standard EADGBE. Thicker strings carry more mass, so they hold their energy
// longer and give up their high harmonics sooner: `hold` rises with pitch
// because it is a per-period figure, and a high string goes round the loop
// more often per second.
const STRINGS = [
  { name: "E", open: 82.41, gauge: 2.0, hold: 0.98935, tone: 0.3 },
  { name: "A", open: 110.0, gauge: 1.72, hold: 0.99124, tone: 0.34 },
  { name: "D", open: 146.83, gauge: 1.45, hold: 0.99298, tone: 0.39 },
  { name: "G", open: 196.0, gauge: 1.2, hold: 0.9939, tone: 0.47 },
  { name: "B", open: 246.94, gauge: 0.98, hold: 0.99449, tone: 0.53 },
  { name: "e", open: 329.63, gauge: 0.82, hold: 0.99522, tone: 0.6 },
];

/** Semitones each peg has been turned from standard. */
const detune = [0, 0, 0, 0, 0, 0];
/** Fret held on each string; 0 is open. */
const frets = [0, 0, 0, 0, 0, 0];

const NOTE_NAMES = ["A", "A♯", "B", "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯"];

/** @param {number} hz */
function noteName(hz) {
  const nearest = Math.round(12 * Math.log2(hz / 440));
  const octave = 4 + Math.floor((nearest + 9) / 12);
  return `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${octave}`;
}

/** @param {number} i */
function pitchOf(i) {
  return STRINGS[i].open * 2 ** ((detune[i] + frets[i]) / 12);
}

// --- audio ----------------------------------------------------------------
/** @typedef {{ ctx: AudioContext, bus: GainNode }} Engine */

/** @type {Engine | null} */
let engine = null;
/**
 * The ringing note on each string. `root` is the pitch its buffer was rendered
 * at, so bending it later is a playbackRate ratio against that.
 * @type {Array<{ source: AudioBufferSourceNode, gain: GainNode, root: number } | null>}
 */
const voices = [null, null, null, null, null, null];

/**
 * Build the context on the first gesture, not on load: a fresh AudioContext is
 * suspended under the autoplay policy, and resuming it here means the gesture
 * that asked for a note is the one that gets it.
 * @returns {Engine}
 */
function audio() {
  if (!engine) {
    const ctx = new AudioContext();
    const bus = ctx.createGain();
    bus.gain.value = 0.55;

    // A guitar body is mostly two resonances — the air in the box (Helmholtz,
    // near 100Hz) and the soundboard itself (near 200Hz) — over a top that
    // rolls off. Karplus-Strong on its own is a string in a vacuum, and sounds
    // like a rubber band; this is the box around it.
    const rumble = ctx.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 68;

    const air = ctx.createBiquadFilter();
    air.type = "peaking";
    air.frequency.value = 102;
    air.Q.value = 1.6;
    air.gain.value = 7;

    const top = ctx.createBiquadFilter();
    top.type = "peaking";
    top.frequency.value = 198;
    top.Q.value = 1.2;
    top.gain.value = 4.5;

    const wood = ctx.createBiquadFilter();
    wood.type = "peaking";
    wood.frequency.value = 430;
    wood.Q.value = 0.9;
    wood.gain.value = 2;

    const sheen = ctx.createBiquadFilter();
    sheen.type = "highshelf";
    sheen.frequency.value = 4200;
    sheen.gain.value = -5;

    // Six strings ringing at once will clip without this.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 8;

    bus.connect(rumble).connect(air).connect(top).connect(wood).connect(sheen);
    sheen.connect(limiter).connect(ctx.destination);
    engine = { ctx, bus };
  }
  if (engine.ctx.state === "suspended") void engine.ctx.resume();
  return engine;
}

/**
 * Stop a string ringing, the way the heel of a hand does.
 * @param {number} i
 * @param {number} seconds
 */
function mute(i, seconds) {
  const held = voices[i];
  if (!engine || !held) return;
  const now = engine.ctx.currentTime;
  held.gain.gain.cancelScheduledValues(now);
  held.gain.gain.setValueAtTime(held.gain.gain.value, now);
  // Exponential ramps must stay above zero or the call throws and the note
  // never stops.
  held.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  held.source.stop(now + seconds + 0.02);
  voices[i] = null;
}

/**
 * @param {number} i string index
 * @param {number} force 0..1, how hard it was hit
 * @param {number} pick 0..0.5, where along the string
 * @param {number} [delay] seconds, so a strum arrives one string at a time
 */
function play(i, force, pick, delay = 0) {
  const { ctx, bus } = audio();
  const string = STRINGS[i];
  const hz = pitchOf(i);

  // Re-striking a ringing string stops it first — one string can only be
  // vibrating one way at a time.
  mute(i, 0.045);

  // Tension does two things at once: it moves the pitch, and it makes the
  // string brighter and tighter. A slack string goes dull as well as flat.
  const tension = clamp(string.tone + detune[i] * 0.045, 0.08, 0.95);
  const samples = pluck(ctx.sampleRate, hz, {
    seconds: 3.9,
    brightness: clamp(tension * (0.55 + force * 0.55), 0.06, 0.98),
    sustain: string.hold,
    pick,
  });

  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);

  const gain = ctx.createGain();
  // Thicker strings move more air.
  gain.gain.value = clamp(0.16 + force * 0.5, 0.1, 0.72) * (0.78 + string.gauge * 0.12);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(bus);
  source.start(ctx.currentTime + delay);
  source.addEventListener("ended", () => {
    if (voices[i]?.source === source) voices[i] = null;
  });

  voices[i] = { source, gain, root: hz };
  ring(i, delay);
}

/**
 * Bend a string that is already sounding to whatever its pitch should now be.
 * Fretting or turning a peg under a ringing note bends it rather than
 * restarting it, which is what both do on a real guitar.
 * @param {number} i
 */
function retune(i) {
  const held = voices[i];
  if (!held || !engine) return;
  held.source.playbackRate.setTargetAtTime(
    pitchOf(i) / held.root,
    engine.ctx.currentTime,
    0.022,
  );
}

// --- drawing --------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
const stage = /** @type {HTMLElement} */ (document.querySelector("#stage"));
const chordLabel = /** @type {HTMLElement} */ (document.querySelector("#chord"));
const tuningLabel = /** @type {HTMLElement} */ (document.querySelector("#tuning"));

/** @type {SVGPolylineElement[]} */
const stringEls = [];
/** @type {SVGCircleElement[]} */
const fingerEls = [];

function draw() {
  const fretGroup = /** @type {SVGGElement} */ (document.querySelector("#frets"));
  for (let n = 1; n <= FRETS; n++) {
    const y = fretY(n);
    const inset = (6 * (y - NUT_Y)) / (BOARD_END - NUT_Y);
    const wire = document.createElementNS(SVG_NS, "line");
    wire.setAttribute("x1", String(72 - inset));
    wire.setAttribute("x2", String(128 + inset));
    wire.setAttribute("y1", y.toFixed(2));
    wire.setAttribute("y2", y.toFixed(2));
    fretGroup.append(wire);
  }

  const stringGroup = /** @type {SVGGElement} */ (document.querySelector("#strings"));
  const fingerGroup = /** @type {SVGGElement} */ (document.querySelector("#fingers"));
  STRINGS.forEach((string, i) => {
    const [px, py] = POST[i];
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute(
      "points",
      `${px},${py} ${NUT_X[i]},${NUT_Y} ${BRIDGE_X[i]},${BRIDGE_Y}`,
    );
    // The wound bass strings are bronze and visibly thicker; the plain trebles
    // are steel. Gauge is the one thing you can see about a string.
    line.setAttribute("class", i < 3 ? "string wound" : "string plain");
    line.style.setProperty("--w", String(string.gauge));
    stringGroup.append(line);
    stringEls.push(line);

    const finger = document.createElementNS(SVG_NS, "circle");
    finger.setAttribute("r", "5.2");
    finger.setAttribute("class", "finger");
    fingerGroup.append(finger);
    fingerEls.push(finger);
  });
}

/**
 * Restart the vibration animation on one string.
 * @param {number} i
 * @param {number} delay
 */
function ring(i, delay) {
  // The attract animation runs until the guitar has been played once.
  stage.dataset.played = "true";
  const line = stringEls[i];
  window.setTimeout(() => {
    line.classList.remove("ringing");
    void line.getBoundingClientRect();
    line.classList.add("ringing");
  }, delay * 1000);
}

function render() {
  frets.forEach((fret, i) => {
    const finger = fingerEls[i];
    if (fret === 0) {
      finger.setAttribute("class", "finger");
      return;
    }
    const y = (fretY(fret - 1) + fretY(fret)) / 2;
    finger.setAttribute("class", "finger down");
    finger.setAttribute("cx", stringX(i, y).toFixed(2));
    finger.setAttribute("cy", y.toFixed(2));
  });

  const barre = frets.every((fret) => fret === frets[0]) ? frets[0] : -1;
  chordLabel.textContent =
    barre === 0 ? "open strings" : barre > 0 ? `barred at fret ${barre}` : "fingered";

  tuningLabel.textContent = STRINGS.map((_, i) => {
    const open = STRINGS[i].open * 2 ** (detune[i] / 12);
    const cents = Math.round(detune[i] * 100);
    return cents === 0 ? noteName(open) : `${noteName(open)}${cents > 0 ? "↑" : "↓"}`;
  }).join("  ");
}

// --- playing --------------------------------------------------------------
/** @type {"strum" | "fret" | "tune" | null} */
let mode = null;
let lastIndex = 0;
let lastTime = 0;
let lastY = 0;
let tuningPeg = -1;
let tuningFrom = 0;

/** @param {PointerEvent} event */
function toView(event) {
  const box = stage.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * VIEW_W,
    y: ((event.clientY - box.top) / box.height) * VIEW_H,
  };
}

/**
 * Where the picking hand is, as a fraction of the string's length.
 * @param {number} y
 */
function pickAt(y) {
  const t = clamp((BRIDGE_Y - y) / (BRIDGE_Y - BOARD_END), 0, 1);
  return 0.06 + t * 0.24;
}

/** @param {number} y */
function fretAt(y) {
  for (let n = 1; n <= FRETS; n++) if (y < fretY(n)) return n;
  return FRETS;
}

/**
 * @param {number} i
 * @param {number} n
 */
function setFret(i, n) {
  if (frets[i] === n) return;
  frets[i] = n;
  retune(i);
}

stage.addEventListener("pointerdown", (event) => {
  const target = /** @type {Element | null} */ (event.target);
  const peg = target?.closest("[data-peg]");
  const { x, y } = toView(event);
  stage.setPointerCapture(event.pointerId);
  event.preventDefault();

  if (peg) {
    mode = "tune";
    tuningPeg = Number(peg.getAttribute("data-peg"));
    tuningFrom = detune[tuningPeg];
    lastY = event.clientY;
    return;
  }

  if (y < NUT_Y) {
    // Beyond the nut: no fingers on the neck at all.
    mode = null;
    frets.fill(0);
    render();
    return;
  }

  if (y < BOARD_END) {
    mode = "fret";
    const n = fretAt(y);
    lastIndex = stringIndexAt(x, y);
    const i = clamp(Math.round(lastIndex), 0, 5);
    // Pressing the fret you are already holding lifts off it.
    setFret(i, frets[i] === n ? 0 : n);
    render();
    return;
  }

  mode = "strum";
  lastIndex = stringIndexAt(x, y);
  lastTime = event.timeStamp;
  const i = clamp(Math.round(lastIndex), 0, 5);
  if (Math.abs(lastIndex - i) < 0.75) play(i, 0.5, pickAt(y));
});

stage.addEventListener("pointermove", (event) => {
  if (!mode || !stage.hasPointerCapture(event.pointerId)) return;
  const { x, y } = toView(event);

  if (mode === "tune") {
    // Up tightens, down slackens — the same direction as the string's pitch.
    const turns = (lastY - event.clientY) / 26;
    detune[tuningPeg] = clamp(tuningFrom + turns, -6, 6);
    retune(tuningPeg);
    render();
    return;
  }

  if (mode === "fret") {
    // Dragging across the neck lays a finger over every string it crosses:
    // one gesture, one barre chord.
    const n = fretAt(y);
    const index = stringIndexAt(x, y);
    const low = clamp(Math.round(Math.min(lastIndex, index)), 0, 5);
    const high = clamp(Math.round(Math.max(lastIndex, index)), 0, 5);
    for (let i = low; i <= high; i++) setFret(i, n);
    lastIndex = index;
    render();
    return;
  }

  const index = stringIndexAt(x, y);
  const elapsed = Math.max(event.timeStamp - lastTime, 1);
  // How fast the hand crosses the strings is how hard they are hit.
  const force = clamp((Math.abs(index - lastIndex) / elapsed) * 90, 0.18, 1);
  const low = Math.min(lastIndex, index);
  const high = Math.max(lastIndex, index);
  for (let i = Math.ceil(low); i <= Math.floor(high); i++) {
    if (i >= 0 && i <= 5) play(i, force, pickAt(y));
  }
  lastIndex = index;
  lastTime = event.timeStamp;
});

for (const type of ["pointerup", "pointercancel"]) {
  stage.addEventListener(type, (event) => {
    mode = null;
    const id = /** @type {PointerEvent} */ (event).pointerId;
    if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
  });
}

/**
 * A strum is not a chord: the hand crosses the strings one at a time, and the
 * 20-odd milliseconds between them is most of what makes it sound strummed.
 * @param {boolean} down true for low-to-high
 */
function strum(down) {
  const order = down ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
  order.forEach((i, step) => play(i, 0.55, 0.17, step * 0.028));
}

// --- keyboard -------------------------------------------------------------
// Everything above is pointer geometry. These give the same instrument to
// someone playing it from the keyboard.
for (const button of document.querySelectorAll("[data-key]")) {
  const i = Number(button.getAttribute("data-key"));
  button.addEventListener("click", (event) => {
    // A pointer click already went through the strum handler above.
    if (/** @type {MouseEvent} */ (event).detail !== 0) return;
    play(i, 0.55, 0.17);
  });
  button.addEventListener("keydown", (event) => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setFret(i, clamp(frets[i] + step, 0, FRETS));
    render();
  });
}

for (const button of document.querySelectorAll("[data-peg]")) {
  const i = Number(button.getAttribute("data-peg"));
  button.addEventListener("keydown", (event) => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    const step = key === "ArrowUp" ? 0.25 : key === "ArrowDown" ? -0.25 : 0;
    if (step === 0) return;
    event.preventDefault();
    detune[i] = clamp(detune[i] + step, -6, 6);
    render();
  });
}

/** @type {HTMLButtonElement} */ (document.querySelector("#strum-down")).addEventListener(
  "click",
  () => strum(true),
);
/** @type {HTMLButtonElement} */ (document.querySelector("#strum-up")).addEventListener(
  "click",
  () => strum(false),
);
/** @type {HTMLButtonElement} */ (document.querySelector("#reset")).addEventListener(
  "click",
  () => {
    detune.fill(0);
    frets.fill(0);
    render();
  },
);

draw();
render();
