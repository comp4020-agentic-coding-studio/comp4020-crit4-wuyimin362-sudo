// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

// main.js builds the frets, the strings and the tuning readout from geometry
// rather than from markup, so nothing in dist/index.html proves any of it
// arrived. Running the real module against the real built page is what catches
// the failure that looks like nothing at all: a selector that stopped matching,
// and a guitar with no strings on it.

beforeAll(async () => {
  const built = new JSDOM(readFileSync(resolve("dist/index.html"), "utf8"));
  document.body.innerHTML = built.window.document.body.innerHTML;
  await import("../main.js");
});

describe("the guitar is strung", () => {
  it("draws six strings", () => {
    expect(document.querySelectorAll("#strings .string")).toHaveLength(6);
  });

  it("draws twelve frets, crowding toward the body", () => {
    const wires = [...document.querySelectorAll("#frets line")].map((line) =>
      Number(line.getAttribute("y1")),
    );
    expect(wires).toHaveLength(12);

    const ascending = wires.every((y, n) => n === 0 || y > wires[n - 1]);
    expect(ascending, "frets are out of order down the neck").toBe(true);

    const gaps = wires.slice(1).map((y, n) => y - wires[n]);
    const narrowing = gaps.every((gap, n) => n === 0 || gap < gaps[n - 1]);
    expect(
      narrowing,
      "fret spacing must shrink toward the bridge — even spacing is a ladder, not a fretboard",
    ).toBe(true);
  });

  it("gives the bass strings a heavier gauge than the trebles", () => {
    const gauges = [...document.querySelectorAll("#strings .string")].map((line) =>
      Number((line as SVGElement).style.getPropertyValue("--w")),
    );
    const thinning = gauges.every((w, i) => i === 0 || w < gauges[i - 1]);
    expect(thinning, "string thickness is the one thing you can see about a string").toBe(
      true,
    );
  });

  it("marks the wound bass strings apart from the plain trebles", () => {
    const wound = document.querySelectorAll("#strings .string.wound");
    const plain = document.querySelectorAll("#strings .string.plain");
    expect(wound).toHaveLength(3);
    expect(plain).toHaveLength(3);
  });
});

describe("the guitar is in standard tuning", () => {
  it("reads back as EADGBE at the right octaves", () => {
    const tuning = document.querySelector("#tuning")?.textContent?.trim();
    expect(tuning?.split(/\s+/)).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
  });

  it("starts with no fingers on the neck", () => {
    expect(document.querySelector("#chord")?.textContent).toBe("open strings");
    expect(document.querySelectorAll("#fingers .finger.down")).toHaveLength(0);
  });
});

describe("every control is reachable without a pointer", () => {
  it("exposes a named button per string and per tuning peg", () => {
    const strings = document.querySelectorAll("button[data-key]");
    const pegs = document.querySelectorAll("button[data-peg]");
    expect(strings).toHaveLength(6);
    expect(pegs).toHaveLength(6);

    for (const control of [...strings, ...pegs]) {
      expect(
        control.textContent?.trim(),
        "a control with no name is a blank to anything reading the page aloud",
      ).toBeTruthy();
    }
  });

  it("has a strum that does not need a drag", () => {
    expect(document.querySelector("#strum-down")).toBeTruthy();
    expect(document.querySelector("#strum-up")).toBeTruthy();
  });
});
