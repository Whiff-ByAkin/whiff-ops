/**
 * whiff-ops — the founders' console, as a static page.
 *
 * ## What it is and what it is not
 *
 * Every button here is one `/ops` request. **There is no logic in this file that
 * decides anything about a person**: no scoring, no eligibility, no counting
 * toward a threshold. When a founder places four people in a Circle, the engine
 * still refuses anybody who is not WAITING; when they send a Circle an evening,
 * `runCircleActivityPass` still picks it. This page is a set of triggers and a
 * reader for what came back.
 *
 * That rule is why there is no "suggest this specific activity" control. Which
 * evening a Circle gets is `rankForCircle`'s arithmetic over all four members'
 * profiles, and a founder overriding it is how a Circle ends up somewhere its
 * worst-served member dreads. The console asks for an evening; it does not pick
 * one.
 *
 * ## Why it is a second origin at all
 *
 * The console has always been served from `whiff-api` itself, and the argument
 * for that is good: one origin, one deployment, one auth, and no way for the
 * console to drift onto a stale copy of the routes it drives. This build exists
 * because it deploys somewhere a founder can reach without a Railway deploy.
 *
 * **The cost is CORS, and it is a real one.** The API must carry
 * `CORS_ORIGINS=https://<this-deployment>` or every request here fails at the
 * browser with a message that does not say why. See the README.
 *
 * ## The token
 *
 * `OPS_TOKEN`, kept in `sessionStorage` and gone when the tab closes. Not
 * `localStorage`: this token is every founder power in the product, and a
 * bearer credential that survives a closed laptop is a credential somebody
 * else's session inherits. It is never put in a URL, so it cannot land in a
 * history entry, a referrer, or a server log.
 */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  api: sessionStorage.getItem('whiff.api') || '',
  token: sessionStorage.getItem('whiff.token') || '',
  connected: false,
  people: [],
  circles: [],
  picked: new Set(),
};

/* ------------------------------------------------------------------ *
 * The wire
 * ------------------------------------------------------------------ */

/**
 * One request, with the two failures that actually happen told apart.
 *
 * A CORS rejection and a dead server both surface as a `TypeError` with no
 * status, and they have completely different fixes — one is a variable on
 * Railway, the other is a deploy. Saying "check CORS_ORIGINS" on every network
 * error would be wrong half the time, so the message names both.
 */
async function call(path, options = {}) {
  if (!state.api) throw new Error('No API URL');
  const res = await fetch(state.api.replace(/\/+$/, '') + '/ops' + path, {
    ...options,
    headers: {
      authorization: `Bearer ${state.token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  }).catch(() => {
    throw new Error(
      'Could not reach the API. Either it is down, or this origin is not in '
      + 'CORS_ORIGINS on the server.',
    );
  });

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }

  if (!res.ok) {
    const message = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body;
}

const post = (path, body) =>
  call(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

let toastTimer;
function toast(message, bad = false) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('bad', bad);
  t.classList.add('up');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('up'), bad ? 6000 : 2600);
}

/** Runs an action, reports either way, and never leaves a button spinning. */
async function guard(button, fn, done) {
  const was = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try {
    const out = await fn();
    if (done) toast(typeof done === 'function' ? done(out) : done);
    return out;
  } catch (e) {
    toast(e.message, true);
    return null;
  } finally {
    if (button) { button.disabled = false; button.textContent = was; }
  }
}

function setStatus(text, kind) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status' + (kind ? ' ' + kind : '');
}

/* ------------------------------------------------------------------ *
 * Connect
 * ------------------------------------------------------------------ */

async function connect() {
  state.api = $('#api').value.trim();
  state.token = $('#token').value.trim();
  if (!state.api || !state.token) return toast('API URL and token, both', true);

  setStatus('connecting…');
  try {
    const meta = await call('/meta');
    state.connected = true;
    sessionStorage.setItem('whiff.api', state.api);
    sessionStorage.setItem('whiff.token', state.token);
    setStatus(`connected · ${meta?.actor_version ?? 'ok'}`, 'ok');
    await refresh();
  } catch (e) {
    state.connected = false;
    setStatus('not connected', 'bad');
    toast(e.message, true);
  }
}

async function refresh() {
  await Promise.all([loadOverview(), loadReview(), loadPeople(), loadCircles()]);
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

async function loadOverview() {
  const wrap = $('#overview-cards');
  wrap.replaceChildren();
  const o = await call('/overview').catch(() => null);
  if (!o) return;

  const cards = [];
  for (const [k, v] of Object.entries(o.users || {})) cards.push([k.toLowerCase(), v]);
  for (const [k, v] of Object.entries(o.circles || {})) cards.push([`circles ${k.toLowerCase()}`, v]);
  if (o.formation) {
    cards.push(['formable now', o.formation.circles_formable_now]);
    cards.push(['waiting, no circle', o.formation.waiting_without_a_circle]);
  }

  for (const [k, v] of cards) {
    const c = el('div', 'card');
    c.append(el('div', 'k', k), el('div', 'v', String(v)));
    wrap.append(c);
  }
}

/* ------------------------------------------------------------------ *
 * Review — the two gates
 * ------------------------------------------------------------------ */

async function loadReview() {
  await Promise.all([loadChallenges(), loadInventory()]);
}

async function loadChallenges() {
  const wrap = $('#challenge-queue');
  wrap.replaceChildren();
  const d = await call('/challenges/review').catch(() => null);
  const rows = d?.challenges ?? [];
  if (!rows.length) {
    wrap.append(el('p', 'empty', 'Nothing waiting.'));
    return;
  }

  for (const ch of rows) {
    const item = el('div', 'item');
    item.append(el('h3', null, ch.title));

    const body = el('p', 'body', ch.prompt);
    item.append(body);
    if (ch.why) item.append(el('p', 'why', ch.why));

    /**
     * Who it is about and what it rests on.
     *
     * A challenge is a claim about a PERSON, and the value keys are what the
     * proposal was allowed to rest on — `recordProposedChallenge` re-resolves
     * every one against that person's real profile, so a reviewer seeing a key
     * they do not recognise is seeing a bug rather than a bad sentence.
     */
    const meta = el('div', 'acts');
    if (ch.user?.display_name) meta.append(el('span', 'pill', ch.user.display_name));
    for (const key of ch.target_value_keys ?? []) meta.append(el('span', 'pill', key));
    item.append(meta);

    const acts = el('div', 'acts');
    const ok = el('button', 'primary small', 'Approve');
    ok.onclick = () => guard(ok, () => post(`/challenges/${ch.id}/approve`), 'Approved')
      .then(loadChallenges);

    const no = el('button', 'danger small', 'Reject');
    no.onclick = () => {
      // The note is the most valuable field on the route: the only free-text
      // signal anywhere about WHY a challenge was wrong, and what a prompt
      // revision reads.
      const note = prompt('Why is this wrong? (optional, and the only record of it)');
      if (note === null) return;
      guard(no, () => post(`/challenges/${ch.id}/reject`, note ? { note } : {}), 'Rejected')
        .then(loadChallenges);
    };
    acts.append(ok, no);
    item.append(acts);
    wrap.append(item);
  }
}

async function loadInventory() {
  const wrap = $('#inventory-queue');
  wrap.replaceChildren();
  const d = await call('/inventory/review').catch(() => null);
  const rows = d?.items ?? [];
  if (!rows.length) {
    wrap.append(el('p', 'empty', 'Nothing waiting.'));
    return;
  }

  for (const it of rows) {
    const item = el('div', 'item');
    item.append(el('h3', null, it.title));
    if (it.description) item.append(el('p', 'body', it.description));

    const meta = el('div', 'acts');
    for (const p of [it.city, it.venue_name, it.category, it.cost_band]) {
      if (p) meta.append(el('span', 'pill', p));
    }
    // The link is the whole gate for a scouted row: there is something to check
    // it against, which is exactly what a challenge does not have.
    if (it.source_url) {
      const a = el('a', null, 'source');
      a.href = it.source_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.append(a);
    }
    item.append(meta);

    const acts = el('div', 'acts');
    const ok = el('button', 'primary small', 'Approve');
    ok.onclick = () => guard(ok, () => post(`/inventory/${it.id}/approve`), 'Approved')
      .then(loadInventory);
    const no = el('button', 'danger small', 'Reject');
    no.onclick = () => {
      const note = prompt('Why? (optional)');
      if (note === null) return;
      guard(no, () => post(`/inventory/${it.id}/reject`, note ? { note } : {}), 'Rejected')
        .then(loadInventory);
    };
    acts.append(ok, no);
    item.append(acts);
    wrap.append(item);
  }
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

async function loadPeople() {
  const filter = $('#state-filter').value;
  const d = await call('/users' + (filter ? `?state=${filter}` : '')).catch(() => null);
  state.people = d?.users ?? [];
  renderPeople();
}

function renderPeople() {
  const wrap = $('#people-list');
  wrap.replaceChildren();

  const q = $('#people-search').value.trim().toLowerCase();
  const rows = state.people.filter((u) =>
    !q || (u.display_name || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q));

  if (!rows.length) {
    wrap.append(el('p', 'empty', 'Nobody here.'));
    return;
  }

  for (const u of rows) {
    const row = el('div', 'row');

    // Only a WAITING person can be placed — `takeSeat` refuses anybody else, so
    // offering the tick elsewhere would be offering a button that 422s.
    const box = el('input');
    box.type = 'checkbox';
    box.disabled = u.state !== 'WAITING';
    box.checked = state.picked.has(u.id);
    box.onchange = () => {
      box.checked ? state.picked.add(u.id) : state.picked.delete(u.id);
      updateProposeButton();
    };
    row.append(box);

    row.append(el('span', 'name', u.display_name || '(no name)'));
    row.append(el('span', 'pill', u.state));
    if (u.city) row.append(el('span', 'meta', u.city));
    row.append(el('span', 'grow'));

    const week = el('button', 'small', 'Send a week');
    week.onclick = () => guard(week, () => post(`/users/${u.id}/week`), 'Week sent');
    row.append(week);

    const ch = el('button', 'small', 'Propose a challenge');
    ch.onclick = () => guard(
      ch,
      () => post(`/users/${u.id}/challenge`),
      'Proposed — approve it in Review before it can be sent',
    ).then(loadChallenges);
    row.append(ch);

    wrap.append(row);
  }
  updateProposeButton();
}

function updateProposeButton() {
  const n = state.picked.size;
  const b = $('#propose-open');
  b.disabled = n !== 4;
  b.textContent = n === 4 ? 'Place these four in a Circle' : `Place four in a Circle… (${n}/4)`;
  $('#propose-hint').textContent = n === 4
    ? 'The fourth seat starts the Circle — there is no accept step, members are placed.'
    : 'Tick exactly four waiting people. Only WAITING people can be ticked.';
}

async function proposeCircle(button) {
  const ids = [...state.picked];
  const first = state.people.find((u) => u.id === ids[0]);
  const city = first?.city;
  if (!city) return toast('That person has no city', true);

  // A Circle does not cross cities: `formCircles` partitions on the string, so
  // four people from two hubs is four people who cannot meet.
  const mixed = ids.some((id) => state.people.find((u) => u.id === id)?.city !== city);
  if (mixed) return toast('All four have to be in one city', true);

  const out = await guard(
    button,
    () => post('/circles/propose', { city, user_ids: ids }),
    (o) => `Circle ${o?.circle?.state ?? 'created'}`,
  );
  if (out) {
    state.picked.clear();
    await Promise.all([loadPeople(), loadCircles(), loadOverview()]);
  }
}

/* ------------------------------------------------------------------ *
 * Circles
 * ------------------------------------------------------------------ */

async function loadCircles() {
  const d = await call('/circles').catch(() => null);
  state.circles = d?.circles ?? [];

  const wrap = $('#circle-list');
  wrap.replaceChildren();
  if (!state.circles.length) {
    wrap.append(el('p', 'empty', 'No Circles.'));
    return;
  }

  for (const c of state.circles) {
    const row = el('div', 'row');
    row.append(el('span', 'name', c.city || 'Circle'));
    row.append(el('span', 'pill', c.state));
    row.append(el('span', 'meta', c.id.slice(0, 8)));
    if (c.health?.band) row.append(el('span', 'pill', `health ${c.health.band}`));
    row.append(el('span', 'grow'));

    const open = el('button', 'small', 'Open');
    open.onclick = () => showCircle(c.id);
    row.append(open);
    wrap.append(row);
  }
}

async function showCircle(id) {
  const host = $('#circle-detail');
  host.replaceChildren(el('p', 'empty', 'Loading…'));

  const d = await call(`/circles/${id}`).catch((e) => { toast(e.message, true); return null; });
  if (!d) { host.replaceChildren(); return; }

  const box = el('div', 'detail');
  box.append(el('h2', null, `${d.circle.city} · ${d.circle.state}`));

  const live = (d.members || []).filter((m) => m.status === 'active');

  /**
   * The consequence a founder is least likely to have in mind.
   *
   * `MIN_ATTENDANCE` is `CIRCLE_SIZE`, and nothing in production refills a
   * vacated seat — so a Circle below four needs a guest on every evening it
   * ever holds again.
   */
  if (d.circle.state === 'ACTIVE' && live.length < 4) {
    const warn = el('p', 'why');
    warn.textContent = `${live.length} of 4 seats live. Quorum is four, and nothing `
      + `refills a seat — every evening from here needs a guest.`;
    box.append(warn);
  }

  for (const m of d.members || []) {
    const row = el('div', 'row');
    row.append(el('span', 'name', m.display_name || m.user_id.slice(0, 8)));
    row.append(el('span', 'pill', m.status));
    if (m.exit_reason) row.append(el('span', 'meta', m.exit_reason));
    row.append(el('span', 'grow'));

    if (m.status === 'active') {
      const out = el('button', 'danger small', 'Release…');
      out.onclick = () => releaseMember(out, id, m.user_id, m.display_name);
      row.append(out);
    }
    box.append(row);
  }

  const acts = el('div', 'acts');
  if (d.circle.state === 'ACTIVE') {
    const ev = el('button', 'primary small', 'Send an evening');
    ev.onclick = () => guard(
      ev,
      () => post(`/circles/${id}/activity`),
      (o) => o?.outcome?.activity_id
        ? 'Evening created'
        : `Nothing sent: ${o?.outcome?.skipped ?? 'unknown'}`,
    ).then(() => showCircle(id));
    acts.append(ev);
  }
  box.append(acts);

  // Any evening still taking answers can be given a guest.
  const open = (d.activities || []).filter((a) => a.state === 'RSVP_OPEN');
  if (open.length) {
    box.append(el('h2', null, 'Evenings open for RSVP'));
    for (const a of open) {
      const row = el('div', 'row');
      row.append(el('span', 'name', a.title));
      row.append(el('span', 'grow'));
      const g = el('button', 'small', 'Find a guest');
      g.onclick = () => guard(
        g,
        () => post(`/activities/${a.id}/guest`),
        (o) => o?.outcome?.invited
          ? 'Guest invited'
          : o?.outcome?.nobodyAvailable
            ? 'Looked, and nobody in the pool was viable'
            : 'Nothing to do — already held or already has a guest',
      );
      row.append(g);
      box.append(row);
    }
  }

  host.replaceChildren(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function releaseMember(button, circleId, userId, name) {
  /**
   * Two destinations, and the choice is not a detail.
   *
   * `paused` is the exit: out of the rotation, and nothing places them again.
   * `waiting` is a re-seat: back in the pool with the clock restarted. A member
   * removed for conduct and one whose Circle was simply wrong for them need
   * different ones, so this asks rather than defaulting to the harsher.
   */
  const to = prompt(
    `Remove ${name || 'this member'} from the Circle.\n\n`
    + `Type "waiting" to put them back in the pool for a new Circle,\n`
    + `or "paused" to take them out of the rotation entirely.`,
    'waiting',
  );
  if (to === null) return;
  if (to !== 'waiting' && to !== 'paused') return toast('Type waiting or paused', true);

  const note = prompt('A note for the ledger (optional)') || undefined;

  guard(
    button,
    () => post(`/circles/${circleId}/members/${userId}/release`, {
      to, exit_reason: 'operator', ...(note ? { note } : {}),
    }),
    (o) => o?.needs_a_guest_every_evening
      ? 'Released. That Circle now needs a guest every evening.'
      : 'Released.',
  ).then(() => { showCircle(circleId); loadPeople(); loadOverview(); });
}

/* ------------------------------------------------------------------ *
 * Passes
 * ------------------------------------------------------------------ */

const PASSES = [
  ['timers', 'Timers', 'Fires every due timer once.'],
  ['formation', 'Formation', 'Fills seats from the waiting pool.'],
  ['activities', 'Activities', 'Gives due Circles an evening.'],
  ['challenges', 'Challenges', 'Setter proposes. Nothing is sent unreviewed.'],
  ['guest-invites', 'Guest invites', 'Sends the invitation a shortfall already chose.'],
];

function renderPasses() {
  const wrap = $('#pass-buttons');
  wrap.replaceChildren();
  for (const [slug, title, blurb] of PASSES) {
    const c = el('div', 'card');
    c.append(el('div', 'k', title), el('div', 'meta', blurb));
    const b = el('button', 'small', 'Run');
    b.style.marginTop = '.6rem';
    b.onclick = () => guard(b, async () => {
      const out = await post(`/passes/${slug}`);
      const pre = $('#pass-out');
      pre.hidden = false;
      pre.textContent = JSON.stringify(out, null, 2);
      return out;
    }, `${title} ran`).then(refresh);
    c.append(b);
    wrap.append(c);
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

$('#api').value = state.api;
$('#token').value = state.token;
$('#connect').onclick = connect;
$('#propose-open').onclick = (e) => proposeCircle(e.currentTarget);
$('#state-filter').onchange = loadPeople;
$('#people-search').oninput = renderPeople;

for (const tab of document.querySelectorAll('#tabs button')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('#tabs button')) t.classList.toggle('on', t === tab);
    for (const s of document.querySelectorAll('.tab')) {
      s.classList.toggle('on', s.id === tab.dataset.tab);
    }
  };
}

renderPasses();
setStatus('not connected');
// A token in sessionStorage means this tab already connected once; a reload
// should not ask again.
if (state.api && state.token) connect();
