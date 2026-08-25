# Process overview

## What I built

**Slide** — a one-string slide guitar in the browser. It is fretless on purpose:
there is no wrong note to land on because there are no frets to miss, and a
slide is the cheapest gesture that reads as expressive rather than as pressing
buttons. Every note is synthesised in the page with Karplus–Strong — a burst of
noise fed round a delay line one period long — so nothing is played back. Where
you press along the string is the pitch, and where you press across it is the
pick position: near the bridge is thin and bright, over the neck is dark and
round.

## The moments that mattered

### Choosing an algorithm that could be tested rather than only heard

This week's brief says an agent can build a synth but can't hear the result.
That is literally true of the agent I was directing, and it is the constraint I
designed around rather than worked despite. Before writing any audio code I made
the synthesis a pure function of numbers — `synth.js` takes a sample rate and a
frequency and returns a `Float32Array`, and touches no Web Audio at all.

The obvious build is to reach straight for `AudioContext` and wire oscillators
together, which is what most Web Audio examples show. That version can only be
evaluated by listening, so every regression in it is silent until someone plays
the page. Splitting the arithmetic out let me put a sensor where my ears
couldn't go: `spec/synth.test.ts` measures the fundamental by autocorrelation and
asserts the note is within 1.5% of the pitch it was asked for at 110, 220 and
440 Hz, that it decays, that it stays inside −1..1, and that pick position
changes the timbre without changing the loudness. Those five checks are the
difference between "the code looks like a synthesiser" and "the string is
demonstrably vibrating at 220 Hz and dying away."

[`79156db`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/79156db)

### Writing the spec as failing tests before there was anything to run them against

I turned the published spec into tests before writing the prototype, so the
mechanically-checkable lines were red from the start and going green was the
work.

[`5a3d0f0`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/5a3d0f0)

Sorting the spec was the useful part, more than the tests themselves. Two lines
could be checked — sound is synthesised live rather than played back, and the
instrument is playable with whatever is at hand. Four could not: whether it is
expressive, whether a stranger can play it uninstructed, whether there is really
no way to play it wrong, and whether I can account for how I directed the work.
Naming that second group explicitly stopped me from writing a test that
pretended to cover them, which is the failure mode I was heading for — a green
suite that says nothing about whether the thing is any good.

The first line drove a design decision rather than just an assertion. Testing
"playable with mouse, keyboard or touch" pushed me to make the string a real
`<button>` instead of a `<div>` with a pointer handler. Pointer events then
cover mouse, touch and pen from one code path, and being a button carries the
keyboard, the focus ring and an accessible name for free — one element
satisfying an interaction requirement and an accessibility one at once.

### Two decisions where the obvious Web Audio approach is a dead end

Both of these are the kind of thing that looks fine until you hear it, so both
are recorded in `CLAUDE.md` rather than only fixed in place.

A slide needs the pitch to move continuously while the note rings, and the
textbook way to do that in Web Audio is a real feedback loop — a `DelayNode`
whose `delayTime` you modulate. Web Audio imposes a 128-sample floor on any
delay inside a feedback loop, which at 48 kHz caps the fundamental at about
344 Hz. A guitar's open high E is 330 Hz, so that approach dies at exactly the
range the instrument needs. I render the buffer instead and slide with
`playbackRate`.

The second is subtler: render the buffer at a fixed reference pitch and a slide
of two octaves resamples the note into a chipmunk. Rendering it at the pitch it
was struck at keeps `playbackRate` near 1, so only the distance actually
travelled costs any timbre.

[`8e920f7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/8e920f7)
carried the harness forward from Assignment 1 before any prototype work, keeping
the operating rules that still applied — never pipe a check into `tail` when you
then act on its exit code — and dropping the Astro-specific ones I had stopped
needing.

## What the checks still can't tell me

`pnpm check` is green and says nothing about whether any of this sounds good.
The decay constant, the glide time and the two-octave range are all values I
chose and then verified numerically, never by ear. That gap is the point of the
week, and it is what I want the crit to tell me.
