# Dr. Tahsin Ahmed Nafi — Website + Appointment Backend

English page (`/`), Bangla page (`/bn`), an appointment API, and a private admin dashboard (`/admin`).
No npm dependencies. Needs **Node 22.5 or newer**. Data is stored in a SQLite file.

## Run locally
```bash
ADMIN_PASSWORD='choose-a-long-password' node server.js
# site:  http://localhost:3000        admin: http://localhost:3000/admin
```

## Settings (environment variables)
| Name | Purpose |
|---|---|
| `ADMIN_PASSWORD` | **Required**, 8+ characters. Used to sign in at `/admin`. |
| `SESSION_SECRET` | Long random string. Set it so admin logins survive restarts. |
| `PORT` | Default 3000. |
| `DB_PATH` | Where the SQLite file lives. Default `./data/appointments.db`. |
| `NODE_ENV` | Set `production` online (turns on Secure cookies and caching). |

See `.env.example`.

## What it does
- `POST /api/appointments` — public form endpoint (validation, honeypot, 5 requests/hour/IP).
- `/admin` — password-protected list of requests: filter by status, search, confirm/complete/cancel, private notes, delete, **Export CSV**.
- If the server is unreachable, the site forms fall back to a WhatsApp link.

## Before going live
1. Put the doctor's photo in `public/` as `dr-nafi.jpg` and enable the two `<img>` lines in `public/index.html` and `public/bn.html`.
2. Social links: in both pages replace `YOUR-PAGE-NAME` (Facebook) and `YOUR-PROFILE-NAME` (LinkedIn) with his real page and profile.
3. Replace `8800000000000` with the real number (phone + WhatsApp) and fill every `[ ... ]` placeholder in both pages.
4. Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET`.
5. Serve over HTTPS (any host below does this for you).

## Deploying
The backend needs a host that runs Node and keeps a disk (SQLite file), so static-only hosts such as plain Netlify or GitHub Pages will not work.
- **Render / Railway / Fly.io:** create a Web Service from this folder (start command `node server.js`), add the env vars, and attach a persistent disk mounted at `/data` with `DB_PATH=/data/appointments.db`.
- **Docker / VPS:** `docker build -t nafi-site . && docker run -d -p 3000:3000 -v nafi-data:/data -e ADMIN_PASSWORD=... -e SESSION_SECRET=... nafi-site`, then put Nginx or Caddy in front for HTTPS.
- Back up the `.db` file regularly (or use Export CSV).

## Privacy note
Appointment requests contain patient names, phone numbers and symptoms. Keep the admin password private, serve only over HTTPS, and delete old requests you no longer need.
