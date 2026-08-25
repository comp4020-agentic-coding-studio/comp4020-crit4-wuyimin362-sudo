# Crit 4 — An instrument

## What was the breakthrough that moved the work forward?

Deciding that the synthesis had to be a pure function before it was allowed to
touch Web Audio.

The brief points out that an agent can build a synth but can't hear the result.
That was exactly my situation, and my first instinct was to treat it as a
handicap to work around — build it, then go and listen, then come back and
describe what was wrong. That loop is slow and it only catches what I happen to
notice.

Pulling the arithmetic out into `synth.js`, with no `AudioContext` anywhere near
it, turned a thing I could only listen to into a thing I could measure. A test
now recovers the fundamental from the raw samples by autocorrelation and fails
if the string isn't within 1.5% of the note it was asked for. That check would
have caught an off-by-one in the delay line instantly; by ear I would have heard
"slightly wrong somehow" and gone looking in the wrong place.

## What did this work change about who I want to be as a software developer?

I've been treating tests as something you write about code that exists. This
week the useful move was the opposite: deciding what could be measured, and then
shaping the code so that the measurable part was separable from the part that
can only be judged.

The corollary is knowing when to stop. Four of the nine spec lines can't be
tested, and writing something green-looking that gestured at them would have
made the suite less honest, not more. Leaving them explicitly untested — and
carrying them into the crit as open questions — was the more disciplined answer.
