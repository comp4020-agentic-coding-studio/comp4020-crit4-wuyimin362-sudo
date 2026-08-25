import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Turns the mechanically-checkable lines of crit 4's published spec into
// backpressure. The rest — expressiveness, whether a stranger can play it
// uninstructed, whether there's really no way to get it wrong — only a person
// can judge; that happens at the crit, not here. See spec/README.md.
// https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/04-instrument/

const DIST = resolve("dist");
const doc = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8")).window.document;

// All shipped JS concatenated, so these checks don't care which file the
// synthesis code ends up living in.
function shippedScript(dir: string = DIST): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return [shippedScript(path)];
      return path.endsWith(".js") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}
const script = shippedScript();

describe("spec: sound is made live in the page, not played back", () => {
  it("uses the Web Audio API to synthesize sound", () => {
    expect(
      /\b(AudioContext|OscillatorNode|AudioBufferSourceNode)\b/.test(script),
      "no AudioContext/OscillatorNode/AudioBufferSourceNode found in the shipped JS " +
        "— the spec asks for sound made live in the page, not played back",
    ).toBe(true);
  });

  it("does not ship the instrument itself as a pre-recorded audio file", () => {
    expect(
      doc.querySelector("audio, video"),
      "an <audio>/<video> element suggests playback, not live synthesis",
    ).toBeNull();
    expect(
      /\.(mp3|wav|ogg|m4a)\b/i.test(script),
      "a reference to a static audio file suggests playback, not live synthesis",
    ).toBe(false);
  });
});

describe("spec: playable with whatever is at hand", () => {
  it("gives the player at least one native, keyboard-operable control", () => {
    const main = doc.querySelector("main");
    const controls = main?.querySelectorAll("button, input, select, textarea, a[href]") ?? [];
    expect(
      controls.length,
      "main has no native interactive control yet — a <button>/<input> gets pointer, " +
        "keyboard and touch for free; a div with only a click handler doesn't",
    ).toBeGreaterThan(0);
  });
});
