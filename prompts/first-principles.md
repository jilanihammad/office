# First Principles Thinking

First principles thinking has one move: **separate what is TRUE from what is CONVENTION, then reason only from what is true.**

Everything else — frameworks, best practices, competitive analysis, analogies — is pattern-matching dressed up as thinking. Frameworks and analogies may generate hypotheses, but they do not count as evidence.

---

## 1. State the Problem Raw

One sentence. No jargon, no category labels, no reference to existing solutions.

Not: *"Build a better project management tool"*
But: *"Help groups of people coordinate work toward shared outcomes"*

Not: *"Disrupt the insurance industry"*
But: *"Reduce the financial damage of unpredictable bad events"*

If your description references an existing product category, you haven't gone deep enough. You're still inside someone else's framing.

---

## 2. Surface and Classify Every Belief

Write down everything you believe about this problem. Everything — especially the things that feel obviously true:

- How people currently solve it
- What they'd pay
- What form the solution takes
- Who the customer is
- How you'd build it
- How they'd find you

Now mark each one:

- **T** — Fundamental truth (physics, math, logic, replicated behavioral tendencies with explicit boundary conditions, regulation with real enforcement)
- **A** — Assumption (inherited from how the industry works, what competitors do, "best practices," analogies, your past experience)

**The test:** If you wiped everyone's memory and started civilization over, would this still be true? If yes, **T**. If it depends on how things happen to be organized right now, **A**.

**For every T, include: (a) evidence source, (b) scope conditions, and (c) confidence (High/Med/Low). Any T missing one of these defaults to A.**

Most of what you believe is **A**. If your list isn't mostly A's, you're not being honest.

---

## 3. Decompose the Assumptions

For each **A**:

**Why do I believe this?** Trace it to its source. You'll usually land on *"because that's how X does it"* or *"because someone credible said so"* or *"because it's always been this way."*

**What is the underlying truth beneath this assumption?** This is the Musk battery move. Everyone said batteries cost $600/kWh. He asked what batteries are made of — cobalt, nickel, aluminum, carbon, polymers, a steel can. He checked material costs on the London Metal Exchange: ~$80/kWh. The $520 gap was pure convention. Find your $520 gap.

**If this assumption evaporated tomorrow, what would change?** If the answer is "nothing much," it's not load-bearing. If the answer reshapes your entire approach, you found something.

---

## 4. Identify the Immovable Constraints

What cannot change regardless of how clever you are?

- **Physical** — speed of light, thermodynamics, human biological limits (attention, sleep, cognition)
- **Mathematical** — information-theoretic limits, combinatorial explosions, unit economics that fail at every scale
- **Behavioral invariants** — loss aversion, finite attention, trust requires consistency, people satisfice rather than optimize, status drives behavior. Note: these are tendencies with boundary conditions, not universal laws. Context matters.
- **Hard legal** — not "regulations" broadly, but the ones with real teeth, active enforcement, and consequences you can't absorb

Everything else is a candidate soft constraint. Treat it as movable only after specifying what must change and what it would cost.

---

## 5. Reason Up From Truths

Pretend nothing exists. No current products, no current industry, no current tech stack (unless it's physics).

**First, define the objective function:** What is being optimized, for whom, and over what time horizon?

Given ONLY your fundamental truths and hard constraints:

**What does the theoretically optimal solution look like?** Don't self-censor for feasibility yet. If you could snap your fingers, what would the perfect resolution of your raw problem (Step 1) be?

**Where exactly does reality deviate from that optimum, and why?** Be specific. Each deviation is either:
- A hard constraint (accept it)
- A convention nobody has challenged (attack it)
- A coordination problem waiting to be solved (that's your opening)

**What would you build knowing only the fundamentals?** Not a better version of what exists. The thing you'd construct if you'd never seen the current solutions and only understood the underlying truths. **For each major design choice, point to the specific T(s) and hard constraint(s) that imply it. If you can't, it's an assumption.**

---

## 6. Catch Yourself Cheating

You've built a logic chain from truths to a solution. Now break it:

**Where did you sneak an assumption back in?** You almost certainly did. Re-read your reasoning. Any step that relies on *"how things work"* rather than *why things must be that way* is smuggled convention.

**Are you reasoning from truth, or reverse-engineering a justification for what you already wanted to build?** If your first-principles analysis conveniently confirms your original idea, be deeply suspicious. You probably worked backward.

**Construct the strongest opposing conclusion using the same T set.** If both your conclusion and its opposite can be derived from the same truths, your truths are under-specified. Go back and sharpen them.

**What's the most uncomfortable conclusion your reasoning produces?** If every conclusion feels comfortable, you haven't gone deep enough. First principles thinking regularly produces answers that feel *wrong* precisely because they violate convention. Sit with the discomfort.

**What would you have to believe for your conclusion to be wrong?** Name it specifically. If you can't articulate it, you don't understand your own reasoning.

---

## The Gut Check

> Did I actually change my mind about anything?

If no, you either:
1. Were already reasoning from first principles (unlikely), or
2. Performed the exercise as confirmation, not inquiry (likely)

**Name one observation that, if true, would invalidate your conclusion.** If you can't, your conclusion isn't falsifiable — and unfalsifiable conclusions aren't reasoning, they're faith.

This process should be **destabilizing**. It should make you uncomfortable about things you were confident about. If it felt smooth, you did it wrong. Go back to Step 2 and be more honest about what's actually a **T**.

---

*First principles thinking is not a one-time exercise. Every time you say "we should do X because that's how it's done" or "the industry standard is Y" or "competitors all do Z" — you've left first principles. The question is always: but is it TRUE?*
