# iQuizify — Next.js app

> **Handover docs:** [TEACHER_GUIDE.md](TEACHER_GUIDE.md) (how to run a quiz) and
> [DEPLOYMENT.md](DEPLOYMENT.md) (install checklist, what changed, known limitations).

This is a Next.js (App Router + TypeScript) app with two flows:

- **`/`** — participant flow: enter an access code (or scan a QR code that
  pre-fills it via `?code=`), enter your Gmail address plus demographics,
  take the timed quiz, see the results.
- **`/admin`** — facilitator dashboard: log in (default password
  `admin123` — you are prompted to change it; passwords are stored hashed), create/edit assessments with MCQ or Likert-scale questions,
  generate QR codes + access codes, view raw responses (including each
  respondent's Gmail), view analytics charts, export CSV/PDF, archive, and
  delete (delete is locked until you've exported at least once).

## Requirements

**Node.js 22.5 or newer.** The database uses Node's built-in `node:sqlite`
module (stable since Node 22.5) instead of a third-party native package —
deliberately, so `npm install` never needs to download or compile a native
binary. That's a meaningful reliability difference for locked-down
networks (common on government/office IT): nothing to fetch from GitHub,
no C++ build toolchain required. Check your version with `node -v`; get
the latest LTS from https://nodejs.org if needed.

## Data storage

Data lives in a **SQLite-compatible database**, accessed through
[Turso](https://turso.tech)'s libSQL client (`lib/server-db.ts`), via a
few small API routes (`app/api/db`, `app/api/login`, `app/api/responses`,
`app/api/responses/check`). Every device that connects — participants on
their own phones/laptops and the admin dashboard — reads and writes that
same database, so everyone sees the same data.

**Local development:** with no extra setup, this falls back to a local
SQLite file at `data/iquizify.db`, same as before — nothing to configure.

**Deploying to Vercel (or any other stateless/serverless host):** a local
file does **not** work there — the filesystem is read-only outside `/tmp`
and isn't shared between invocations, which is why login and every other
DB-backed route used to fail with `ENOENT ... mkdir '/var/task/data'`.
You need a real Turso database instead:

1. Install the Turso CLI and sign up (free tier is plenty for this app):
   `curl -sSfL https://get.tur.so/install.sh | bash`, then `turso auth login`.
2. Create a database: `turso db create iquizify`.
3. Get the connection details:
   - `turso db show iquizify --url` → `TURSO_DATABASE_URL`
   - `turso db tokens create iquizify` → `TURSO_AUTH_TOKEN`
4. In your Vercel project → Settings → Environment Variables, add both
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then redeploy.

If `TURSO_DATABASE_URL` isn't set on a deployment where `VERCEL=1` (Vercel
sets this automatically), the app throws a clear startup error instead of
silently trying to write a local file that won't persist.

If you're upgrading from an older version of this app that used a plain
`data/db.json` file (pre-SQLite) or `data/assessora.db` (pre-rebrand),
those are only auto-migrated when running against a **local** file
database. Migrating existing local data into Turso is a one-time step:
run the app locally first (against the local file) to confirm the
migration happened, then use `turso db shell iquizify < dump.sql` with a
dump of the local file, or contact Turso's docs on importing an existing
SQLite file — see https://docs.turso.tech/features/embedded-replicas or
`turso db import`.

### Backups

- **Local-file deployments:** the server snapshots the database every 6
  hours while it's running (configurable via `BACKUP_INTERVAL_HOURS`, `0`
  disables it), keeping the most recent 30 backups in `backups/`. Manual /
  scheduled: run `npm run backup` any time, or wire it into cron
  (Linux/macOS) or Task Scheduler (Windows).
- **Turso deployments:** the local backup script doesn't apply once
  `TURSO_DATABASE_URL` is set (there's no local file to snapshot). Use
  Turso's own backups/point-in-time restore and database branching —
  see https://docs.turso.tech/features/backups.

## One-time-per-Gmail enforcement

Registration requires a `@gmail.com` address. Before the quiz starts, the
server checks whether that Gmail address already has a response for this
assessment and shows the existing record instead of letting them retake
it. The **database itself** enforces this with a `UNIQUE(assessment_id,
email)` constraint — not just application code — so it holds even if two
submissions land at the exact same instant on different devices.

## Rate limiting

Login (`/api/login`), the Gmail duplicate-check, and response submission
are all rate-limited per IP (see `lib/rate-limit.ts`) to make brute-forcing
a password or spamming requests impractical. This uses an in-memory store,
which is fine for a single, long-running process (e.g. `node server.js` on
a VPS). **On Vercel or another serverless host**, each function
invocation can run on a different instance with its own memory, so the
limit only applies per-instance rather than globally — brute-force
protection is weaker there. If that matters for your deployment, swap the
in-memory store for a shared one (e.g. Redis, or Vercel KV) so all
instances share the same counters.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` (and `npm start`, see below) bind to `0.0.0.0`, so the app is
reachable from other devices on the same wifi network — not just
`localhost`. It's also mobile-friendly: the participant flow and the admin
dashboard both adapt to phone screen sizes.

### Access on your phone (any wifi network)

When you run `npm run dev` (or `npm start`), the terminal prints the
computer's actual LAN address(es) — not just Next.js's own
`http://0.0.0.0:3000` line, which is just the bind address and isn't
something you can actually open. Look for a block like:

```
  Reachable from other devices on the same wifi at:
    http://192.168.1.42:3000
```

Open that link (or type it) from any phone on the **same wifi network**.
It's detected fresh from the OS each time you start the server, so it's
always correct for whatever network you're currently on.

### HTTPS

- **While developing:** `npm run dev:https` serves over HTTPS using
  Next.js's built-in dev certificate.
- **For a more persistent setup:** `npm run build` then `npm start` runs a
  small custom server (`server.js`) that serves the app on **both**:
  - `http://<lan-ip>:3000`
  - `https://<lan-ip>:3443`

  The HTTPS certificate is self-signed and generated automatically the
  first time you run it (saved to `certs/`, gitignored) — no setup needed.
  Phones will show a "not trusted" / "not private" warning the first time
  they visit; tap **Advanced → Proceed** (Chrome/Android) or **Show
  Details → visit this website** (Safari/iOS) once to continue. This is
  expected for a self-hosted local server and only needs to be done once
  per device.
  - Change ports with `PORT=8080 HTTPS_PORT=8443 npm start` if needed.
  - If you'd rather run HTTP-only in production, use
    `npm run start:http-only`.

## Build

```bash
npm run build
npm run start
```

## Project structure

```
app/
  layout.tsx          Root layout (fonts, global CSS)
  page.tsx             Participant route ("/")
  admin/page.tsx        Admin route ("/admin")
  globals.css          Ported design system (CSS variables, components)
components/
  Toast.tsx             Shared toast hook/host
  participant/
    ParticipantApp.tsx   Landing → registration → quiz → results
  admin/
    AdminApp.tsx          Login + tab shell
    AssessmentsTab.tsx
    ResponsesTab.tsx
    AnalyticsTab.tsx       Chart.js doughnut charts
    ArchiveTab.tsx
    SettingsTab.tsx
    AssessmentModal.tsx    Create/edit assessment + question builder
    QrModal.tsx            QR code (via `qrcode` package) + download/copy
    DeleteModal.tsx
    AssessmentCard.tsx
lib/
  types.ts              Shared TS types
  db.ts                  Client-side fetch wrapper around the API routes
  server-db.ts            Server-side SQLite store (data/iquizify.db)
  rate-limit.ts           Per-IP rate limiting + trusted client-IP resolution
  utils.ts               uid/genCode/fmtDate/LIKERT_PRESETS/levelForPct
  export.ts               CSV + PDF (jsPDF/jspdf-autotable) export helpers
  seed.json               Original demo dataset (1 assessment, 300+ responses)
app/api/
  db/route.ts             GET/POST the whole shared DB (used by admin)
  login/route.ts           POST credential check (rate-limited)
  responses/route.ts       POST a new response (atomic Gmail dedupe, rate-limited)
  responses/check/route.ts GET whether a Gmail already responded (rate-limited)
server.js                 Custom HTTP+HTTPS server for `npm start` (self-signed cert,
                           auto backups, stamps real client IP for rate limiting)
scripts/
  print-lan.js             Prints the real LAN IP to the terminal (used by start:http-only)
  dev.js                   Wraps `next dev`: prints LAN IP + auto-opens the browser
  backup-db.js              Manual/cron-triggered database backup (`npm run backup`)
```

## Notes / deliberate differences from the static version

- QR codes are generated client-side with the `qrcode` npm package instead
  of the CDN-loaded `qrcodejs`, and the join link now points to `/?code=...`
  (single app) rather than a separate `questiq-participant.html` file.
- Chart.js, jsPDF, and jspdf-autotable are npm dependencies rather than
  CDN `<script>` tags.
- ESLint is disabled during `next build` (`next.config.js`) since this is a
  straightforward structural port; feel free to re-enable and clean up lint
  warnings if you extend it.

## Using Supabase (Postgres) instead of Turso

The database driver is chosen in `lib/db-driver.ts`. Turso stays the default;
set these to switch to Supabase:

- `DB_PROVIDER=supabase`
- `POSTGRES_URL` (or `SUPABASE_DB_URL`) — the Supabase pooled connection string
  (already provided by Vercel's Supabase integration).

Tables are created on first request, with row-level security enabled so the
public Supabase API can't read them. To carry existing data over from Turso,
run `node scripts/migrate-turso-to-supabase.js` once (see the header comment
in that file for the env vars) **before** setting `DB_PROVIDER` in production.
