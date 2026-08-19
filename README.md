# whiff-ops

The founders' console: the screen a person reads before anything Whiff generated
reaches a member.

## Where the console actually lives right now

**Inside `whiff-api`, not here.** It is served from the API's own origin:

```
whiff-api/src/ops/index.ts   the routes, behind a bearer token
whiff-api/src/ops/ui.ts      serves the two files below
whiff-api/public/ops.html    the shell
whiff-api/public/ops.js      the whole console, one file, no build step
```

That was a deliberate choice rather than an accident of where somebody put the
file. The console reads and writes through `/ops`, which is the same auth and
the same origin as the API — so there is no second deployment to keep in step,
no CORS, and no way for the console to drift onto a stale copy of the routes it
drives.

## What it gates

Two review queues, and both exist because the thing behind them reaches a real
person unread otherwise:

- **Inventory** — a scouted row carries a `source_url` a reviewer opens. Nothing
  is selectable until somebody approves it.
- **Challenges** — text Setter wrote *about one person*. There is no URL to
  check it against; the reviewer's judgement is the whole gate, and
  `weekly.assign` refuses anything that has not passed it.

It also holds the last-evening shelf — the venues a Circle's sixth evening may
be drawn from, which is the one flag in the product that decides where Whiff
spends money. No agent may set it.

## What this repository is for

Nothing yet. It is the home for whiff-ops if and when the console outgrows being
a single file served by the API — a build step, a second surface, or a tool that
has no business living in the request path.

**Extracting the console into here is a decision, not a chore.** It would trade
one origin and one deployment for two, and the argument that put it in
`whiff-api` has not changed. Read that argument before moving anything.
