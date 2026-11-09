# iQuizify — Deployment & Handover Notes

For the person who installs, hosts and maintains the platform. See `README.md` for the full
reference (database options, HTTPS, backups, rate limiting). This file is the short checklist.

## What you are deploying

A Next.js 14 app (React, TypeScript). One codebase serves both:

- `/` — student quiz flow
- `/admin` — teacher dashboard

Data is stored in SQLite/libSQL (a local file in development, [Turso](https://turso.tech) or
Supabase Postgres in production). Requires **Node.js 22.5+**.

## Quick start (school server / laptop on the local network)

```bash
npm install
npm run build
npm start          # serves http on :3000 and https on :3443
```

The terminal prints the LAN address(es) students can open on their phones.
Data is saved to `data/iquizify.db` and snapshotted to `backups/` every 6 hours.

## Hosted deployment (Vercel or similar)

1. Create a Turso database and note its URL and token (see README → *Data storage*), **or** set
   `DB_PROVIDER=supabase` with the Supabase variables.
2. Set the environment variables `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the host.
3. Deploy. The first request creates the tables and seeds a demo assessment (`BALANGA25`) —
   delete it from the dashboard before real use.

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Hosted database connection |
| `DB_PROVIDER=supabase` | Use Supabase Postgres instead |
| `AUTH_SECRET` | Optional. Key that signs admin session cookies (auto-generated if unset) |
| `PORT`, `HTTPS_PORT` | Ports for `npm start` |
| `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` | Local backup schedule (file databases only) |

## First-day checklist

- [ ] Sign in at `/admin` (default `admin` / `admin123`) and **change the password immediately**
      (Settings → Admin accounts; the dashboard nags you with a banner until you do). Add one account
      per teacher.
- [ ] Delete the demo assessment and its demo responses.
- [ ] Settings → Student registration: add your courses and subjects; keep the *Student form* option.
- [ ] Create a test quiz, take it on a phone, and confirm the result and the Excel export.
- [ ] Confirm backups are running (`backups/` folder) or that Turso backups are enabled.

## What was added in this release

- Teacher & student welcome screens, access-code screen and results screen in the new green design.
- **Auto-grading** with a server-side re-check: the server recomputes scores from the stored answer
  key, so a score can't be altered from the browser.
- **Per-quiz settings:** time limit with auto-submit, shuffled questions, shuffled answer choices,
  show/hide correct answers.
- **Student registration** (student number, name, school Gmail, gender, course, subject) with course/subject filters, export columns and per-course/per-subject summaries.
- **Excel export** (`.xlsx`: Results, Summary with per-course and per-subject tables, Question analysis), plus
  improved PDF summary.
- **Real admin login:** signed session cookies on every dashboard route, hashed passwords, a
  student-safe public data endpoint (see *Security model*).
- Stronger alt-tab detection (also catches switching to a window that doesn't hide the page).
- Student registration form as the default; the full demographic form is a setting.

## Security model

- **Admin login uses a signed session cookie** (HttpOnly, SameSite=Lax, 12 hours, `Secure` on https).
  Every dashboard API route (`/api/db` writes, accounts, presence, proctoring, archive/purge/recover,
  Google Forms import, live tab-switch list) rejects requests without a valid session (401), and rejects
  cross-site requests (403).
- **Passwords are stored as salted scrypt hashes** and are never sent to the browser. Any plain-text
  password from an older install is hashed automatically the first time the server reads it.
- **Changing a password signs that account out everywhere else.**
- **Students get a reduced view of the data:** `GET /api/db` without a session returns only the
  registration options and *active* assessments. No responses, archive or admin accounts.
- New passwords must be at least 8 characters and cannot be the factory default (`admin123`). The
  dashboard shows a banner until the default password is changed.
- The cookie-signing key is `AUTH_SECRET` if set, otherwise it is generated once and stored in the
  database (table `app_secrets`), so every server instance shares it. Set `AUTH_SECRET` to a long random
  string if you prefer to manage it yourself; changing it signs everyone out.

## Known limitations

1. **Answer keys are sent to students' browsers** (needed for instant right/wrong feedback). The
   "Show correct answers: Off" option hides them in the interface, but a technical student could still
   find them in the network traffic. Full protection needs per-question grading on the server.
2. **Rate limiting is in-memory**, so it is per server instance (see README). Login is limited to 5
   attempts per 5 minutes per IP.
3. **The student duplicate-check (`/api/responses/check`) returns an existing submission** to anyone
   who knows the assessment id and the student's email.
4. Registration only accepts Gmail and school/government domains (`gmail.com`, `gov.ph`, `educ.ph`,
   `education.ph`, `edu.ph`). Change the list in `lib/utils.ts` (`ALLOWED_EMAIL_DOMAINS`) if your school
   uses another domain.
5. There is no "forgot password" email flow. A super admin can set a new password for any account in
   Settings. If the only super admin is locked out, set the account password directly in the database
   (the `admin_accounts` value in table `meta`): replace the `password` with the text `admin123`; it is
   re-hashed on the next login and the default-password banner reminds you to change it.

## Maintenance

- **Backups:** automatic for file databases; use Turso's backups for hosted databases.
- **Restoring:** stop the app, replace `data/iquizify.db` with a file from `backups/`, start again.
- **Updating:** `npm install && npm run build`, then restart. Back up first.
- **Checking health:** open `/` (student page) and `/admin`; both should load.
