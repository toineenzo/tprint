# Free content APIs for surprise-me: research notes

**Date verified: 2026-07-22.** Every endpoint below was live-tested with
`curl` on that date, not taken from documentation or memory. API liveness
rots fast — several of the "well known" options in this space are already
dead — so re-verify before acting on anything here.

**Context:** `tprint` currently ships bundled JSON (`app/content/*.json`,
loaded by `app/content.py`) for jokes / fortunes / recipes in English and
Dutch. This document evaluates whether live public APIs could replace or
supplement that. **Conclusion up front: no, not for this app.** See
[Recommendation](#recommendation).

---

## TL;DR

- **No API in any category supports Dutch**, except `nl.wikiquote.org`.
  Since the maintainer's own instance runs `DEFAULT_LANGUAGE=nl`, switching
  to live APIs would regress the primary deployment language.
- **Recipes are structurally wrong for a receipt printer** — measured median
  ~16 cm of paper per recipe, up to 28 cm.
- **Several canonical options are dead**, including `quotable.io`, whose
  domain no longer resolves at all.
- The useful outcome of this research is a list of **bundleable datasets**,
  not APIs. See [Bundleable datasets](#bundleable-datasets-the-actually-useful-outcome).

---

## Dead / dying — verified, do not build on these

| Endpoint | Verified state (2026-07-22) |
|---|---|
| `api.quotable.io` | **DNS does not resolve.** `dig NS quotable.io` returns nothing — the domain itself lapsed, not just the app. The GitHub repo (`lukePeavey/quotable`) is still up and its README still documents the API, which makes this look alive when it isn't. |
| `api.forismatic.com` | Cloudflare **522** (origin down) over both HTTP and HTTPS. |
| `recipepuppy.com/api` | **404**. |
| `type.fit/api/quotes` | **Zombie.** Returns HTTP 200 but only **5 quotes / 443 bytes** — the old ~1600-quote dataset is gone. The domain is now an unrelated typing-tutor site with no API docs. A naive health check passes; the data is useless. |
| `fortunecookieapi.com` | DNS dead. |
| `api.quotegarden.io` | DNS dead. |
| `api.realinspire.tech` | DNS dead. (Was a suggested quotable replacement.) |
| `api.jokes.one` | 500 without a key. |
| `api.jokeapi.dev` | Does not resolve — **the `v2.` subdomain is required** (`v2.jokeapi.dev`). Easy mistake. |

---

## Jokes

### JokeAPI — `https://v2.jokeapi.dev`

- **No key**, no registration, no payment. Verified v2.3.3, 1368 jokes.
- **120 requests/minute** (5/min for submissions). Rate-limit headers returned.
- **Best filtering of any candidate:** `?safe-mode` plus
  `blacklistFlags=nsfw,religious,political,racist,sexist,explicit`.
  Verified working — response includes a `flags` object and `safe: true`.
- **Languages: `cs, de, en, es, fr, pt`.** **No Dutch** — confirmed
  `?lang=nl` returns error code 106 "No matching joke found."
- **License:** MIT covers the *code*. Joke data is community-submitted; the
  docs only disclaim liability rather than granting a content license.
  Redistribution is unchallenged in practice but not formally permitted.
- **Risk:** last GitHub release Oct 2021; maintainer states source moved to
  a private git server. Service is healthy, public repo is stale.

### icanhazdadjoke.com

- No key. **Requires a custom `User-Agent` header** (verified working).
- No documented rate limit, no documented content license.
- Clean/SFW by nature. English only.

### official-joke-api.appspot.com

- No key, works. English only, clean.
- **Entire dataset is a 61 KB JSON file on GitHub** (verified HTTP 200):
  `https://raw.githubusercontent.com/15Dkatz/official_joke_api/master/jokes/index.json`
- Better as a *bundling source* than as an API. Free App Engine hosting is
  an availability risk.

### api.chucknorris.io

- No key, alive.
- **Real NSFW problem:** the category list includes `explicit`, and there is
  **no exclusion parameter** — plain `/jokes/random` draws from the whole
  pool. Confirmed by pulling `?category=explicit`; content is genuinely
  sexual. Only safe usage is whitelisting categories yourself.
- English only, no stated license.

---

## Recipes

### The paper-length problem (measured, not estimated)

Sampled 12 random TheMealDB meals and computed wrapped line counts at
48 columns (ingredients + instructions + headers):

- **Median ~37 lines ≈ 16 cm** of paper
- **Range 13–67 lines ≈ 5–28 cm**
- Ingredient counts up to 19; instruction bodies up to 1776 characters

A typical API recipe is a **15–30 cm receipt**. The bundled
`{title, ingredients, steps}` shape in `app/content/recipes_*.json` is
deliberately smaller. Truncating an API recipe to fit makes it useless as a
recipe — this is a structural mismatch, not a formatting problem.

### TheMealDB — free tier still usable in 2026, with caveats

- Test key `1` works: `https://www.themealdb.com/api/json/v1/1/random.php`
  verified 200. FAQ states "No limits, the API has unlimited usage."
- **Uniquely permissive content terms.** The ToS says: *"You can scrape,
  copy and modify any content returned from the API, as long as you use the
  official end points."* This is the only source surveyed that explicitly
  permits bundling.
- Restrictions: artwork needs attribution + backlink; *"you cannot publish
  apps to an appstore unless you are a paid subscriber"*; commercial use
  expects Patreon support.
- **Some endpoints are now Patreon-gated.** `randomselection.php` returns
  literally `{"meals":{"1":"Only For Patreon supporters sorry, Sign up
  here: https://www.patreon.com/thedatadb"}}`.
- English only. It has Dutch *dishes* (e.g. "Arnhemse meisjes") but written
  in English.

### Spoonacular

- **50 points/day** free — points, not requests; complex calls cost more.
- Key required (no credit card on their own platform; RapidAPI requires one).
- Backlink required.
- **Caching capped at 1 hour**, after which cached data "must be deleted."
  This clause alone disqualifies it for offline use.

### Edamam

- **Free tier effectively gone** — recipe API page shows only paid plans
  from $9/mo.
- **Basic/Core plans return no cooking instructions at all**, only links to
  source sites. Instructions require the Plus tier.
- Caching restricted to six named fields (macros + URI/title/image).
  Building a copy of their database is explicitly prohibited.
- Unusable for this app at any tier that's affordable.

### Tasty

- Public API retired; RapidAPI-only and keyed.

---

## Fortunes / quotes

### api.quotable.kurokeita.dev — best live option

- Maintained rehost of the quotable codebase **and dataset**, keyless, alive.
- **180 requests/minute** documented.
- **Supports `?maxLength=`** — sampled at `maxLength=120` and got 46–82
  character quotes. Exactly receipt-sized.
- MIT code; quote dataset license unspecified (same gap the original had).
- **Risk:** one person's Vercel deployment — the same failure mode that
  killed `quotable.io`. Do not treat as durable infrastructure.

### ZenQuotes

- No key, alive.
- **5 requests per 30 seconds per IP.**
- **Mandatory attribution:** "Inspirational quotes provided by ZenQuotes
  API" with a live link — which on a thermal printer means printing it.
- Free tier serves hourly-cached data anyway, and their own docs
  *recommend* pulling 50 quotes and looping them locally — a tacit
  endorsement of bundling.

### api.adviceslip.com

- No key, alive. 2-second response cache. No documented rate limit or license.
- Lengths measured 24–92 chars: ideal size.
- **Profanity present and unfilterable.** One of six samples pulled was
  *"Rule number 1: Try not to die. Rule number 2: Don't be a dick."*
  No filter parameter exists. English only.

### stoic-quotes.com/api/quote

- Keyless, alive, short.
- **Content is genuinely public domain** (Marcus Aurelius, Seneca) —
  cleanest licensing story in the entire survey. Narrow in theme.

### Also alive

- **FavQs** `/api/qotd` — keyless for QOTD only; other endpoints need accounts.
- **DummyJSON** `/quotes/random` — 1454 quotes, keyless, but it's a
  mock-data service, not a content service. Not intended as a data source.
- **api.kanye.rest** — novelty.

### nl.wikiquote.org — the only Dutch source found anywhere

- MediaWiki REST API is alive; content is **CC BY-SA 4.0** — properly
  licensed and redistributable with attribution.
- **The catch is real:** `/page/random/summary` returns an article summary
  about a person, not a quote. Extracting individual quotes means parsing
  wikitext, and share-alike attribution would need to be printed.

---

## Summary table

| API | Key? | Rate limit | Content license | Alive | Dutch | Receipt-sized | NSFW filter |
|---|---|---|---|---|---|---|---|
| **JokeAPI v2** | No | 120/min | MIT code; data unspecified | Yes | **No** | Yes | **Excellent** |
| icanhazdadjoke | No (custom UA) | Undocumented | Unspecified | Yes | No | Yes | N/A (clean) |
| official-joke-api | No | Undocumented | Unspecified | Yes | No | Yes | N/A (clean) |
| Chuck Norris API | No | Undocumented | Unspecified | Yes | No | Yes | **No — explicit category** |
| **TheMealDB (key `1`)** | Shared key `1` | "Unlimited" | **Permissive: copying allowed** | Yes | No | **No — 15–30 cm** | N/A |
| Spoonacular | Yes | 50 pts/day | **1-hour cache max** | Yes | No | No | N/A |
| Edamam | Yes, paid | — | Cache 6 fields only | Yes | No | No instructions at all | N/A |
| Tasty | Yes (RapidAPI) | — | Restrictive | Retired publicly | No | No | N/A |
| **quotable (kurokeita)** | No | 180/min | MIT code; data unspecified | Yes | No | **Yes (`maxLength`)** | N/A |
| ZenQuotes | No | **5/30s** | Attribution mandatory | Yes | No | Yes | N/A |
| adviceslip | No | Undocumented | Unspecified | Yes | No | Yes | **No — profanity** |
| stoic-quotes | No | Undocumented | **Public domain** | Yes | No | Yes | N/A |
| nl.wikiquote | No | Wikimedia policy | **CC BY-SA 4.0** | Yes | **Yes** | Needs extraction | N/A |
| quotable.io | — | — | — | **DNS DEAD** | — | — | — |
| forismatic | — | — | — | **522 DEAD** | — | — | — |
| type.fit | — | — | — | **Zombie (5 quotes)** | — | — | — |
| RecipePuppy | — | — | — | **404 DEAD** | — | — | — |

---

## Offline degradation assessment

The current architecture — bundled JSON, zero network calls — is strictly
more reliable than every option surveyed. The licensing terms actively
punish the alternative:

- **Spoonacular: total failure.** The 1-hour cache ceiling means you are
  contractually forbidden from holding a usable offline corpus. 50
  points/day also exhausts before lunch on a moderately used printer.
- **Edamam: total failure**, and it wouldn't work online either (no
  instructions on affordable tiers).
- **ZenQuotes: soft failure.** The 5-req/30s limit forces prefetching
  anyway — at which point it's a bundled dataset with extra steps and a
  mandatory printed backlink.
- **JokeAPI / icanhazdadjoke / adviceslip / kurokeita-quotable: hard
  failure per request**, but all are legally and technically prefetchable.
- **TheMealDB: gracefully bundleable** — the only commercial-ish source
  whose ToS explicitly permits copying content.

### Categories ranked by whether an API is worth it at all

1. **Jokes — good options, marginal value.** JokeAPI's `safe-mode`
   filtering genuinely beats hand-curation and 120/min is generous. But
   **no Dutch** means it can only serve half the users, producing a
   two-tier experience (live English, bundled Dutch) that reads as a bug.
2. **Fortunes/quotes — decent options, weakest licensing.** The best
   (`kurokeita`) is a single hobbyist Vercel deploy whose predecessor's
   domain has already lapsed — re-introducing exactly the failure this
   research uncovered.
3. **Recipes — no good option.** Paywalled, instruction-free, or 15–30 cm
   of thermal paper per print.

---

## Bundleable datasets (the actually useful outcome)

All verified downloadable (HTTP 200) on 2026-07-22:

| Dataset | URL | Size | Notes |
|---|---|---|---|
| official_joke_api | `raw.githubusercontent.com/15Dkatz/official_joke_api/master/jokes/index.json` | 61 KB | Clean, setup/punchline structured, English |
| BSD `fortune` datfiles | `raw.githubusercontent.com/shlomif/fortune-mod/master/fortune-mod/datfiles/fortunes` | 24 KB | Purpose-built for exactly this use case; public-domain-ish. **Needs profanity review** — the classic corpus is not uniformly SFW |
| chuck-db | `github.com/chucknorris-io/chuck-db` | — | Includes explicit entries; filter before use |
| TheMealDB | via official endpoints | — | ToS explicitly permits copying; still needs shortening to fit a receipt |
| nl.wikiquote | MediaWiki API, CC BY-SA 4.0 | — | Only Dutch source found; needs wikitext parsing + attribution |

Note: JokeAPI's own joke data is **not** available at the obvious GitHub
raw path (404 — repo moved to the maintainer's private git server).

---

## Recommendation

**Do not add live API calls to the surprise-me feature.** They would:

- regress Dutch (`DEFAULT_LANGUAGE=nl` is the maintainer's own config),
- introduce a network dependency into a self-hosted app whose whole appeal
  is that it needs no external services (see `CLAUDE.md`, "What this is"),
- add failure modes on a device where a failed print wastes paper, and
- in the recipe case, produce worse output than what's shipped today.

**If more variety is wanted**, the higher-leverage move is a one-time
**dataset import** expanding `app/content/*.json` — keeping `content.py`'s
loader, the `_load()` English fallback, and the zero-dependency runtime
completely intact.

If a live API is ever added anyway, it must be **optional, off by default,
and fall back to the bundled files** on any error or timeout — never the
primary path.
