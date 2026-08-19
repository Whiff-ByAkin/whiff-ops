# whiff-ops

The founders' console: the screen a person reads before anything Whiff generated
reaches a member.

Three static files, no build step, no dependencies. Deploys to Vercel as-is.

```
index.html   the shell
styles.css   the product's palette, taken from Design/WhiffColor.swift
app.js       every button, one /ops request each
vercel.json  headers only — nothing to build
```

## There are now TWO consoles, and that is a decision with a cost

The original is served from `whiff-api` itself, at `/ops-ui/`:

```
whiff-api/src/ops/index.ts   the routes, behind a bearer token
whiff-api/src/ops/ui.ts      serves the two files below
whiff-api/public/ops.html    the shell
whiff-api/public/ops.js      the console, one file
```

That was deliberate and the argument still stands: one origin, one deployment,
one auth, no CORS, and no way for the console to drift onto a stale copy of the
routes it drives.

**This build trades all of that for reachability.** It deploys somewhere a
founder can open without a Railway deploy, and it can be iterated on without
touching the API. The price is paid in three places, and each one is a real
failure mode rather than a note:

1. **CORS.** The API must carry the deployment's origin or every request fails
   in the browser with a message that does not explain itself. See below.
2. **Drift.** These files know the shape of `/ops` responses. A route that
   changes shape breaks this console silently — the in-API one at least ships in
   the same commit as the routes.
3. **The token crosses an origin.** It is sent as a bearer header to the API's
   domain, which is fine, but it is now typed into a page served by Vercel.

If either console has to be the one that survives, it is the one in `whiff-api`.

## Deploying

```bash
vercel deploy          # or point a Vercel project at this repo
```

Then, on the API (Railway → Variables):

```
CORS_ORIGINS=https://<your-deployment>.vercel.app
```

`CORS_ORIGINS` is a comma-separated allowlist and is empty by default — which is
the right default, because the mobile client is native and needs none of it.
Without this variable the console loads, connects to nothing, and says so.

## Using it

Paste the API's base URL and `OPS_TOKEN` into the bar and press **Connect**.

The token lives in `sessionStorage` and is gone when the tab closes. Not
`localStorage`: it is every founder power in the product, and a bearer
credential that survives a closed laptop is one somebody else's session
inherits. It is never put in a URL, so it cannot land in a history entry, a
referrer or a server log.

## What it gates, and what it deliberately cannot do

**Review** is the half that matters. Two queues, both of which exist because the
thing behind them reaches a real person unread otherwise:

- **Challenges** — text Setter wrote *about one person*. There is no URL to check
  it against; the reviewer's judgement is the whole gate, and `weekly.assign`
  refuses anything that has not passed it. The reject note is the most valuable
  field on the route: it is the only free-text signal anywhere about *why* a
  challenge was wrong, and it is what a prompt revision reads.
- **Inventory** — a scouted row carries a `source_url` you open. Nothing is
  selectable until somebody approves it.

**People** places four in a Circle, sends a solo week, or asks Setter for a
challenge. **Circles** sends a Circle its next evening, finds a guest for a short
one, and releases a member. **Passes** fires any of the five by hand.

**No button here decides anything about a person.** Every one is a trigger:

- Placing four people still goes through `takeSeat`, which refuses anybody who is
  not WAITING — inside the transaction, so a request naming somebody already
  seated fails whole rather than leaving half a Circle.
- Sending an evening runs `runCircleActivityPass` scoped to one Circle. **There
  is no way to choose the activity**, and that absence is the point: the pick is
  `rankForCircle`'s arithmetic over all four members' profiles, weighted toward
  the worst-served one, and a founder overriding it is how a Circle ends up
  somewhere one member dreads six times running.
- Finding a guest scores the city's waiting pool and then invites whoever it
  chose. **There is no candidate parameter** for the same reason.
- Proposing a challenge lands it `PROPOSED`. This console cannot approve it in
  the same act — the gate would be pointless if the thing that created a
  challenge could also wave it through.

## Releasing a member asks where they go, and will not default

`paused` is the exit: out of the rotation, and nothing places them again.
`waiting` is a re-seat: back in the pool with `waiting_since` restarted, and
formation will put them in a new Circle.

A member removed for conduct and a member whose Circle was simply wrong for them
need different ones, and a default would quietly pick the harsher for both.

**The seat is not refilled.** Nothing in production refills a vacated seat —
`fillSeat` exists in whiff-core and has no caller — so the Circle continues one
short. Since `MIN_ATTENDANCE` is now `CIRCLE_SIZE`, that Circle needs a guest on
every evening it ever holds again, and the console says so when it happens.
