# Deligatr AI Assistant — widget & wiring

Client-side chat widget + Supabase plan table for the Deligatr support assistant.
The brains live in the existing n8n workflow (`deligatr-assistant-workflow.json`),
reachable at `POST https://deligatr.app.n8n.cloud/webhook/deligatr-assistant`.
This repo is everything around it.

```
supabase/schema.sql          clients table + camelCase view for the workflow
supabase/seed.js             one-time seed of our existing sub-accounts
widget/deligatr-assistant.js full-screen chatbot app (vanilla JS, self-contained)
widget/index.html            the hosted chatbot page GHL links to
widget/test.html             local harness to test outside GHL
```

## 1. Supabase setup

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. Seed the existing clients:
   ```bash
   # first: fill in the real GHL location ids in supabase/seed.js
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   node supabase/seed.js
   ```
   The script refuses to run while `REPLACE_ME` placeholders remain, and skips
   rows that already exist (re-running never resets a bumped tier).

> **⚠️ Flagged mismatch — one workflow edit required.** The workflow's Supabase
> lookup selects `name,locationId,tier,products` (camelCase), but the table uses
> snake_case (`location_id`). `schema.sql` ships a view **`clients_api`** that
> exposes exactly the camelCase names the workflow expects. Point the workflow's
> Supabase node at `clients_api` instead of `clients` — its select list and
> `locationId=eq.<id>` filter then work unchanged. (Alternative: keep `clients`
> and change the node's select to `name,locationId:location_id,tier,products`
> with a `location_id=eq.<id>` filter.)

### Seeding a new client

```sql
insert into clients (location_id, name, tier, products)
values ('<GHL_LOCATION_ID>', 'Acme Co', 'DeliHub Free', '{}');
```

The location id is in the sub-account URL: `.../location/<LOCATION_ID>/...`.

### Bumping a plan tier / adding products

```sql
update clients
set tier = 'DeliHub Pro',
    products = array['DeliMail','DeliReach']
where location_id = '<GHL_LOCATION_ID>';
```

Takes effect on the client's next message — the workflow reads the table per
request; nothing to redeploy.

## 2. Hooking the chatbot into GHL

The assistant is a **full-screen page** (ChatGPT/Claude-style), not a floating
bubble, so it's linked from GHL rather than injected into every page:

1. Host `widget/index.html` + `widget/deligatr-assistant.js` somewhere public
   (same host as the channel-enforcement script is fine).
2. Agency view → **Settings → Custom Menu Links** → add a sub-account menu link
   (e.g. "AI Assistant") pointing at:
   ```
   https://<your-host>/index.html?locationId={{location.id}}
   ```
   GHL substitutes `{{location.id}}` per sub-account, so the app receives the
   location id in its own URL. Choose "open in iframe" or new tab — both work.
3. Open the menu item in any sub-account: the chatbot fills the screen, no
   console errors.

App behavior notes:

- Everything is namespaced `dgtr-` (CSS classes, one `window.__dgtrLoaded` guard).
- `locationId` is resolved from the URL on **every send**, in this order:
  `?locationId=` / `?location_id=` query param (the custom-menu-link case) →
  `/location/<id>/` in the path → `/location/<id>/` in `document.referrer`
  (fallback when iframed inside GHL without the query param) → `null`.
- `contactId` can also be passed as `?contactId=` in the link if available.
- If no `?contactId=` is in the URL, the app probes a few likely `window`
  user globals and falls back to `null` (the workflow tolerates that). To pin
  down GHL's real user object, load with `debug: true` and check the
  `[dgtr] user-global probe` console line — it lists every `window` key
  matching `/user/i`. Once known, add it to the candidate list in
  `getContactId()`.
- History is capped to the last 20 messages (~10 turns) and kept **in memory
  only** — it resets when the page reloads. Deliberate: no localStorage
  (brittle in iframed GHL pages), nothing persisted client-side.
- Failures degrade silently: network/HTTP errors render "I've hit a snag —
  please try again in a moment." and never throw into the host console. Error
  messages are not added to history sent to the backend.
- Replies render via `textContent` — no HTML injection from the backend.

## 3. Local testing

```bash
cd widget
python3 -m http.server 8080
# open http://localhost:8080/test.html
```

- **Mock mode** (checkbox): intercepts fetch in-page and returns canned replies
  (including a fake Pro nudge for questions mentioning "user") — good for UI
  work with no network. The request payload is logged to the console so you can
  verify `question` / `locationId` / `contactId` / `history` shape.
- **Live mode**: leave mock unchecked, set `locationId` to a row that exists in
  the `clients` table, and chat — this round-trips through the real webhook.
- **URL parsing**: leave the mock locationId blank and open
  `test.html?locationId=ABC123` — the app must pick `ABC123` up from the URL
  (visible in the `[dgtr] send` console line). `index.html?locationId=ABC123`
  tests the real hosted page the same way.
- **Local mock endpoint**: paste any URL (e.g. a local n8n at
  `http://localhost:5678/webhook/deligatr-assistant`) into the endpoint field.

## 4. Definition-of-done checklist

- [ ] `test.html` (live mode) round-trips a question and renders the reply.
- [ ] With the mock location's `tier` = `DeliHub Free`, asking for a 3rd user
      returns the DeliHub Pro nudge; after bumping to `DeliHub Pro`, it doesn't.
- [ ] "Talk to a human" → Slack message + GHL task appear.
- [ ] Custom menu link opened from a real sub-account: chatbot renders
      full-screen, no console errors, and a sent message carries the correct
      `locationId` (check the workflow execution log, or `debug: true` + the
      `[dgtr] send` console line).
