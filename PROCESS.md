# Process overview

## What I built

**Six Strings** — an acoustic guitar in the browser, drawn and played as one.
Every note is synthesised in the page with Karplus–Strong (a burst of noise fed
round a delay line one period long), so nothing is played back. You strum by
dragging across the strings over the soundhole, barre by dragging across the
neck, and slacken or tighten a string by turning its tuning peg — which moves
its pitch and its colour together, because that is what tension does.

Two decisions carry most of whether it reads as a guitar rather than as a demo
of a synthesis algorithm. The strings sound **one at a time** as the hand
crosses them: the twenty-odd milliseconds between them is most of the
difference between a strum and a chord stab. And the raw algorithm is a string
in a vacuum, so it plays through a **body** — a Helmholtz air resonance near
100 Hz, the soundboard near 200 Hz, and a rolled-off top.

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

Fretting a ringing string, or turning its peg while it sounds, has to bend the
note rather than restart it. The textbook way to get a moving pitch in Web
Audio is a real feedback loop — a `DelayNode` whose `delayTime` you modulate.
Web Audio imposes a 128-sample floor on any delay inside a feedback loop, which
at 48 kHz caps the fundamental at about 344 Hz. A guitar's open high E is
330 Hz, so that approach dies at exactly the range the instrument needs, and it
dies quietly: it works while you test the low strings. I render the buffer
instead and bend with `playbackRate`.

The second is subtler: render every buffer at one fixed reference pitch and a
bass string resamples into a chipmunk. Each note is rendered at the pitch it was
struck at and its own root recorded alongside it, so `playbackRate` starts at 1
and only the distance actually bent costs any timbre.

[`8e920f7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/8e920f7)
carried the harness forward from Assignment 1 before any prototype work, keeping
the operating rules that still applied — never pipe a check into `tail` when you
then act on its exit code — and dropping the Astro-specific ones I had stopped
needing.

### Throwing away a working prototype

The first version was a one-string slide guitar
([`79156db`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/79156db)).
It passed every test in the suite and it was the wrong thing: it demonstrated
that the synthesis worked without ever looking like an instrument a stranger
would pick up. The spec line it failed — *a stranger can play it uninstructed* —
is one of the four no test can hold, which is exactly why the green suite didn't
notice.

Rebuilding it as a real six-string
([`fc289f9`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-wuyimin362-sudo/commit/fc289f9))
cost almost nothing in the part that was hard, because `synth.js` had no opinion
about how many strings there were or what the page looked like. The separation
that was made for testability paid out as replaceability.

What I added on top was the realism the first version had no room for: fret
spacing that follows the rule of 18 so the neck reads as a neck, wound bass
strings that are visibly thicker, a comb filter for pick position, per-string
decay, and the strum offset. The new test
(`spec/guitar.test.ts`) runs the real module against the real built page,
because the failure mode of a page built entirely from geometry is that a
selector stops matching and the guitar renders with no strings on it — which
looks, from the outside, exactly like nothing happening.

## What the checks still can't tell me

`pnpm check` is green and says nothing about whether any of this sounds good.
The decay constant, the glide time and the two-octave range are all values I
chose and then verified numerically, never by ear. That gap is the point of the
week, and it is what I want the crit to tell me.
