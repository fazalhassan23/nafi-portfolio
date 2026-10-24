# Dr. Tahsin Ahmed Nafi — practice website and content backend

Node.js 22.x with built-in SQLite for local development, plus Turso and Vercel Blob adapters for cloud deployment. Run `npm ci` before starting. The existing appointment database is migrated automatically; existing appointment records are preserved.

## Run

1. Copy `.env.example` to `.env` and set a strong admin password and a random session secret of at least 32 characters.
2. Run `npm start` (or `node --env-file-if-exists=.env server.js`).
3. Open `/` (English), `/bn.html` (Bangla), `/learn.html` (learning library), `/admin` (appointments), or `/studio.html` (content studio).

`npm test` runs integration tests against an isolated temporary database and upload directory. It needs localhost networking. `node test/browser-fixture.js` starts a separate synthetic browser test instance on port 3002; its test-only login is declared in that helper. Stop it with Ctrl+C to remove its temporary data. It does not use the practice database.

## Doctor's content workflow

Sign in at `/studio.html` using the same admin password as the appointment dashboard.

1. Choose **Interactive anatomy**, **ENT trivia**, or **Clinical photograph** and a category: ear, nose, throat, or head & neck.
2. Enter an English title and description/question. Bangla translations are optional; the Bangla library falls back to the English text when a translation is absent.
3. For images, enter a meaningful screen-reader description, then select PNG, JPEG or WebP (maximum 6 MB). The browser decodes the image, resizes it to a maximum 2400-pixel edge and re-encodes it to remove source metadata. Other formats are rejected. Remove identifying details visible in the image before upload; re-encoding cannot do that for you.
4. Click or tap the image to place labels, or use **Add label at center** and the keyboard-accessible X/Y position fields. Each point has a structure name, explanation, common pathology and symptoms, plus optional Bangla translations. Maximum 30 points.
5. Trivia has a separate answer and explanation. Visitors choose when to reveal it.
6. Save as **Draft** to keep the entry and its image private. Choose **Published** and save to make it visible in the library and eligible for the homepage's latest entries. A higher display order places an entry later.
7. Clinical entries require confirmation of appropriate patient consent (where applicable), image rights and de-identification before publication. Visitors choose whether to reveal clinical images. This is a presentation opt-in, not access control: published images are public resources.
8. To withdraw an entry, change it to Draft and save. An image stops being publicly accessible once no published entries use it. Previously downloaded copies cannot be recalled.

The media panel can delete unused uploads. Detaching/deleting a content entry does not delete its image automatically. The server refuses to delete images still attached to any entry. Edit an image's alternative text in its entry and save; because media may be shared, this changes its description wherever it is used.

All published text is displayed as plain text; arbitrary HTML is not supported. The doctor should review medical accuracy and publication rights before publishing. No medical content is seeded into the real database.

## API

All admin routes require the HttpOnly, SameSite=Strict session cookie obtained from `POST /api/admin/login`. Mutation requests accept JSON and reject a mismatched Origin. Logout revokes the session in SQLite. Sign-in attempts are rate limited.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/content` | Published entries; `kind`, `category`, `q`, `limit` (1–100), `offset` |
| `GET /api/content/:id` | One published entry; drafts return 404 |
| `GET /media/:id` | Image bytes; unreferenced/draft-only images require admin authentication |
| `GET /api/admin/content` | All entries, including drafts; same filters plus `status` |
| `POST /api/admin/content` | Create a full content entry |
| `GET /api/admin/content/:id` | Read an entry |
| `PUT /api/admin/content/:id` | Replace an entry with a validated full object |
| `DELETE /api/admin/content/:id` | Delete entry; retains its uploaded image |
| `GET /api/admin/media` | Most recent 200 uploads |
| `POST /api/admin/media` | Upload `{alt, data}`; `data` is base64 PNG/JPEG/WebP, not a data URL |
| `PATCH /api/admin/media/:id` | Update image description with `{alt}` |
| `DELETE /api/admin/media/:id` | Delete unused image; 409 if an entry uses it |
| `POST /api/appointments` | Existing patient appointment request endpoint, 15 requests/hour/IP |
| `GET /api/admin/appointments` | Appointment search/status filters |
| `PATCH /api/admin/appointments/:id` | Set status and private note |
| `DELETE /api/admin/appointments/:id` | Delete appointment |
| `GET /api/admin/export.csv` | Export appointment records |
| `GET /healthz` | Health check |

Content fields: `kind`, `category`, `title`, `title_bn`, `body`, `body_bn`, `answer`, `answer_bn`, `image_id`, `hotspots`, `status`, `consent_confirmed`, `sort_order`. `hotspots` use numeric `x`/`y` percentages (0–100), `label`, `description`, `pathology`, `symptoms`, and the optional corresponding `_bn` fields. Clinical content is always marked sensitive by the server.

## Configuration

| Variable | Meaning |
| --- | --- |
| `ADMIN_PASSWORD` | Required, minimum 8 characters; use a long unique password |
| `SESSION_SECRET` | Required in production, at least 32 characters; signs stored session hashes. Keep stable across restarts; rotating it invalidates existing sessions |
| `PORT` | Defaults to 3000 |
| `DB_PATH` | Defaults to `./data/appointments.db` |
| `UPLOAD_DIR` | Defaults to `uploads/` alongside the database; keep outside `public/` |
| `NODE_ENV` | `production` enables Secure cookies; use HTTPS. `development` works over local HTTP |
| `TRUST_PROXY` | Default off. Set `1` only behind a controlled proxy that overwrites `X-Forwarded-For`; otherwise rate limits use the socket IP |

## Deployment and backups

This service needs one Node process and persistent disk. A static-only host cannot run the API. The Dockerfile includes the backend and content module:

```sh
docker build -t nafi-site .
docker run -d -p 3000:3000 -v nafi-data:/data --env-file .env -e NODE_ENV=production -e DB_PATH=/data/appointments.db -e UPLOAD_DIR=/data/uploads nafi-site
```

Put an HTTPS reverse proxy in front of the service. If the proxy limits request bodies, allow at least 9 MB for JSON image uploads. Do not expose the persistent data directory through the web server. Use a persistent `/data` volume; replacing a container without one loses appointments and media. One local SQLite database is intended for one persistent application instance, not independent replicas.

Back up **both the SQLite database and its uploads directory together**. For a simple consistent backup, stop the service and copy the whole data directory, then restart it. For online backups, use SQLite's backup mechanism and coordinate the media snapshot; do not copy only the live `.db` while ignoring WAL files. Test restoration before launch. Keep backups private because appointments contain patient information. Consider available disk capacity and remove unused media through the studio.

Before public launch, replace the placeholder phone number and chamber address on both homepages, set real production credentials, and have the doctor review qualifications and clinical content. The doctor's supplied photograph is already installed.

## Vercel deployment (same project as the website)

The repository now includes `api/index.js` and `vercel.json`. Static files are served from `public/`; `/api/*`, `/media/*` and `/healthz` are routed to one Node.js function. The function does not start a listening server. Set the Vercel project's **Root Directory to the repository root**, not `public`, **Framework Preset to Other**, and **Node.js to 22.x**. The output directory and empty build command are declared in `vercel.json`.

Vercel functions cannot use a local SQLite file or upload directory as durable storage. The supported cloud configuration is:

- A **Turso/libSQL database** for appointments, content, media metadata, sessions and rate limits.
- A **private Vercel Blob store** for image bytes. Do not choose a public store: draft-image access is enforced by `/media/:id` before the server reads the private blob.

Add these server-side environment variables to the intended Vercel environment, then redeploy:

| Variable | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A long unique password for the doctor's admin dashboard |
| `SESSION_SECRET` | A random secret of at least 32 characters; keep stable across deployments |
| `TURSO_DATABASE_URL` | The hosted database's `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | A database token with read/write permissions |
| `BLOB_READ_WRITE_TOKEN` | The token supplied when the **private** Blob store is connected |

Vercel sets `NODE_ENV=production` automatically. Do not set `DB_PATH` or `UPLOAD_DIR` there. Never prefix these credentials with `NEXT_PUBLIC_` or put them in `public/`. Use separate database and Blob resources for Preview if preview deployments are enabled, so testing cannot change production records. Do not attach an unrelated existing database that contains another application's data.

The studio accepts source photographs up to 6 MB and compresses/re-encodes them to fit within a 3 MB prepared-image limit. Base64 JSON then fits below Vercel's 4.5 MB function payload cap. The server also enforces 3 MB for images uploaded on Vercel. Locally the API continues to accept 6 MB.

New tables are created automatically on the first configured API request. If cloud variables are absent, the backend returns a clear 503 instead of silently saving data to a temporary filesystem. Local SQLite records and local uploads are **not automatically transferred** to the cloud. Back up and explicitly migrate any records that must be retained before changing hosting; do not assume a successful deploy has moved existing data.

Verification:

```sh
npm ci
npm test
npm run test:libsql
```

`test:libsql` runs the content/appointment suite through the libSQL SDK against a temporary local libSQL database; it does not test credentials or connectivity to the hosted database. Tests also cover Vercel's pre-parsed request bodies, rewritten routes, shared database rate limits and the Blob adapter's private-access options using a fake SDK. Real cloud services must still be checked after provisioning.

After deployment verify `/healthz`, admin sign-in, saving a draft, publishing a trivia entry, uploading an image and withdrawing the entry. A draft-only image must return 404 in a signed-out browser. A publish/unpublish change should be visible across deployments because all instances use the same remote database. Never use real patient information for smoke tests.

Reference documentation: [SQLite on Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [function limits](https://vercel.com/docs/functions/limitations), [Turso JavaScript SDK](https://docs.turso.tech/sdk/ts/reference).
