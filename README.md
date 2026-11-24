# Melobud

**Your musical buddy.** Learn songs. Play chords. Grow musically.

Melobud is a guitar-learning app. Upload an MP3 and Melobud recognizes its chords and beats,
plays the song with the chords changing in time, and listens through your microphone while you
practice, telling you whether you played the right chord.

```
PROJECT/
├── frontend/            React 19 + Vite + Tailwind CSS 4 + Lucide (session-cookie auth, /api proxy)
├── backend/             Django 5.2 + Django REST Framework
│   ├── config/          settings, URLs, Celery app, health endpoint
│   ├── accounts/        email-based users, verification codes, password reset, preferences
│   ├── songs/           uploads, validation, library, HTTP-Range audio streaming
│   ├── chord_recognition/  analysis models, job dispatch (Celery/Redis or in-process), persistence
│   ├── practice/        practice sessions, live evaluation endpoint, history, dashboard
│   ├── adminpanel/      staff-only user management API and audit trail
│   ├── audio_engine/    BTC wrapper, temporal smoothing, beats, key/tuning, live guitar classifier
│   ├── vendor/BTC/      BTC-ISMIR19 reference implementation + pretrained weights (MIT)
│   └── tests/           pytest suite (74 tests)
└── README.md
```

## Setup

Requirements: **Python 3.11** (from python.org, with the `py` launcher), **Node.js 20+**, Git.
An NVIDIA GPU is optional — analysis runs on CPU too, just slower.

```bash
# Backend (once)
cd backend
py -3.11 -m venv .venv
# PyTorch: NVIDIA GPU (CUDA 12.6) ...
.venv\Scripts\pip install torch==2.14.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu126
# ... or CPU only:
# .venv\Scripts\pip install torch==2.14.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # then set DJANGO_SECRET_KEY, DATABASE_URL and SMTP (see below)
.venv\Scripts\python manage.py migrate

# Frontend (once)
cd ..\frontend
copy .env.example .env
npm install
```

Generate a secret key with
`.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(50))"`.

## Configuration — `backend/.env`

`backend/.env.example` lists every setting. The two that need your input:

### 1. Supabase (PostgreSQL)

1. Supabase dashboard → your project → **Connect** → **Session pooler** (IPv4-compatible).
2. Copy the URI and put your database password in it:
   ```env
   DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
3. Run `.venv\Scripts\python manage.py migrate` in `backend` to create the tables.

Notes: the *direct* connection host (`db.<ref>.supabase.co`) is IPv6-only and often fails on home
networks — use the pooler. If you use the *transaction* pooler (port 6543) also set
`DB_TRANSACTION_POOLER=true`. Supabase is used purely as Postgres; authentication is handled by
Django. **If `DATABASE_URL` is empty, a local SQLite file is used** (`GET /api/health/` reports which one is active).

### 2. SMTP (verification and password-reset emails)

Sign-up requires a real email. Without SMTP, registration returns *"Email delivery isn't configured"*
— it never pretends to send. Gmail example (needs 2-Step Verification and an
[App Password](https://myaccount.google.com/apppasswords)):

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=you@gmail.com
SMTP_PASSWORD=abcdefghijklmnop      # the 16-character App Password, no spaces
SMTP_USE_TLS=true
EMAIL_FROM=Melobud <you@gmail.com>
```

Any SMTP provider works (Brevo, Mailgun, SendGrid, Outlook…). Port 465 switches to SSL automatically.
Restart the backend after editing `.env`.

### 3. Redis + Celery (optional)

Leave `REDIS_URL` empty and songs are analyzed on a background thread inside Django (one at a
time; requests are never blocked). To use Celery, install a Redis-compatible server
(e.g. [Memurai](https://www.memurai.com/) on Windows, or Redis in WSL) and set
`REDIS_URL=redis://127.0.0.1:6379/0`, then run a Celery worker alongside Django (see below;
`--pool=solo` is the pool Celery supports on Windows). Redis is only the
job broker; all results are stored in Postgres.

## Running

Start the backend and frontend in two terminals, then open **http://localhost:5173**.

```bash
# backend
cd backend
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py runserver 127.0.0.1:8000
.venv\Scripts\python -m celery -A config worker --pool=solo -l info   # only with REDIS_URL

# frontend
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
```

## Deploying to Render

The repository includes a `Dockerfile` (builds the React app, installs CPU-only PyTorch, and serves
everything from Django on one origin) and a `render.yaml` Blueprint.

1. Render dashboard → **New → Blueprint** → connect GitHub → select this repository.
2. Enter the secret values when asked: `DATABASE_URL` (Supabase transaction pooler, port 6543),
   `SMTP_USERNAME` and `SMTP_PASSWORD` (Brevo). `DJANGO_SECRET_KEY` is generated automatically.
3. Deploy. Every push to `main` redeploys.

The Blueprint uses Render's **free** plan, which is suitable for demonstrations only: it has 512 MB of
memory (analysis needs about 1.2 GB, so it will usually fail with a clear message instead of crashing
the site), no persistent disk (uploaded MP3s are erased on each restart or deploy), and the service
would normally sleep after 15 minutes without traffic. Melobud keeps it awake: the server pings its own
`/api/health/` every 10 minutes (`KEEP_AWAKE=true`, see `backend/gunicorn.conf.py`), and a GitHub Actions
workflow (`.github/workflows/keep-awake.yml`) pings it every 10 minutes as a backup that also wakes it
after a restart — set the repository variable `RENDER_URL` to the service URL to enable it. An
always-on service uses about 730 of the workspace's 750 free instance hours per month. For full use, switch the service to **Standard** (2 GB) and
attach a disk mounted at `/app/backend/media`. Email uses Brevo's port 2525 because Render's free plan
blocks the standard SMTP ports.

## Tests

```bash
cd backend  && .venv\Scripts\python -m pytest            # 74 tests, incl. real BTC + Beat This on an MP3
cd frontend && npm run lint && npm test && npm run build
```

`pytest -m "not slow"` skips the test that runs the real models. On Windows, run `npm test` from a
terminal whose path starts with an uppercase drive letter (`C:\…`); vitest mis-resolves itself when
the working directory is `c:\…` (lowercase), which some editors' terminals use.

## How the audio engine works

### Full-song chord recognition — BTC
[BTC](https://github.com/jayg996/BTC-ISMIR19) (Park et al., ISMIR 2019), large-vocabulary model
(170 classes: 12 roots × 14 qualities + N + X), run with PyTorch on CUDA or CPU.

- **Features** — identical to the reference code (log-magnitude CQT, 144 bins, 24 bins/octave,
  hop 2048 @ 22.05 kHz). Verified bit-identical (max abs. difference 0.0) against BTC's own
  `audio_file_to_features`.
- **Inference** — overlapping 108-frame windows (50% hop) with tapered averaging of the softmax
  probabilities, so frames at window edges get context on both sides (the reference script uses
  non-overlapping windows). Probabilities are taken from the model's output projection, so
  confidences are the model's real probabilities.
- **Temporal refinement** — Viterbi decoding with a self-transition prior removes single-frame
  flicker, then segments shorter than 0.3 s are absorbed. Changes are *not* snapped to beats or bars.
- **Compatibility shims** (vendored code is untouched): `run_config.yaml` is read with
  `yaml.safe_load` (the repo's loader breaks on PyYAML ≥ 6), and the `np.float/np.int/np.bool`
  aliases removed in NumPy 1.24 are restored as the builtins they always aliased.
- Performance measured here: a 4 min 17 s song is analyzed in ~5 s on an RTX 4060 Ti.

Each segment stores `label_raw` (the untouched model output, e.g. `F#:7`), `label` (`F#7`) and
`simple` (`F#`), plus `confidence` and `simple_confidence` (probability of the whole beginner family).

### Beginner chord names
Extensions of major/minor triads collapse to the triad (Gmaj7 → G, Am7 → Am) — the triad is a
correct, playable subset. **Sus, dim, aug and half-diminished chords keep their names**, because
calling them major or minor would be wrong. Roots are spelled for the detected key (G# in E major,
Ab in F minor). Users can switch to full names at any time.

### Beats and the 1-2-3-4 counter
[Beat This!](https://github.com/CPJKU/beat_this) (ISMIR 2024) predicts beats **and downbeats**
directly. The bar counter is shown only when at least 75% of bars contain the same number of beats;
otherwise the player shows a beat pulse and says the bar position couldn't be detected reliably.

### Key and tuning
Essentia's `KeyExtractor` when Essentia is importable (Linux/macOS/WSL — there is **no Windows
wheel**); otherwise Krumhansl–Schmuckler on a librosa chromagram. Tuning offset via librosa.

### Live guitar recognition (practice)
Strums are judged **in the browser**, the moment they are heard; there is no upload, so feedback is
immediate (about 0.3 s after a strum). The microphone is captured raw (echo cancellation, noise
suppression and AGC are disabled because they distort guitar harmonics). A strum is detected as a
sudden jump in level above the room's own noise floor, not a fixed loudness, so quiet microphones
work without raising the volume (a ringing chord fading out never re-triggers); clips that are noise
or a single tone rather than a chord are ignored, the pick attack is skipped,
and the next 220 ms are analysed: one FFT, interpolated spectral peaks between 70 Hz and 1.6 kHz,
automatic tuning compensation from the peaks, a 12-bin chroma, and a match against chord templates
that model six harmonics per note. The result is **green** for the expected chord
(7ths/6ths count as their triad) and **red** for anything else; a chord that passes without being played is recorded as **missed**. Each result is saved to the server in
the background for practice history. Measured on physically-modelled guitar strums with noise and
±30 cents detuning: 100% of right chords green and 100% of wrong chords red with a 200 ms window.

## API overview

All endpoints are under `/api/`. Auth uses an HttpOnly Django session cookie; unsafe requests need
the `X-CSRFToken` header. Every song/practice query is filtered by the logged-in owner.

| Area | Endpoints |
|---|---|
| Auth | `GET csrf/` · `GET/PATCH/DELETE me/` · `POST register/ verify/ resend-code/ login/ logout/` · `POST password/forgot/ password/reset/ password/change/` |
| Songs | `GET/POST songs/` (search `q`, `sort`, `status`) · `GET/PATCH/DELETE songs/{id}/` · `GET songs/{id}/audio/` (Range) · `POST songs/{id}/reanalyze/ played/` |
| Practice | `GET practice/dashboard/` · `GET/POST practice/sessions/` · `GET/PATCH/DELETE practice/sessions/{id}/` · `POST practice/sessions/{id}/attempts/` |
| Admin (staff only) | `GET/POST admin/users/` · `GET/PATCH/DELETE admin/users/{id}/` |
| Ops | `GET health/` — database, email and job-queue status |

## Administration

Staff accounts get a **Users** page under *Admin*: search, filter and sort accounts; create users;
edit email, username, display name and password; activate/deactivate, verify, grant administrator
access; delete accounts (with their songs and audio). Safeguards: admins cannot deactivate, demote
or delete themselves; only superusers can modify superusers or grant administrator access. Every
change is recorded in the `adminpanel_auditentry` table. Create the first superuser with
`.venv\Scripts\python manage.py createsuperuser`.

## Security

Passwords hashed with Django's PBKDF2; verification codes are 6 digits from `secrets`, stored as an
HMAC, expire after 15 minutes, single use, 5 attempts max, 60 s resend cooldown. Reset links use
Django's token generator (expire in 1 hour, invalid once the password changes). Forgot-password
responses are identical whether or not the account exists. Rate limits on login, registration,
code entry, email sending, uploads and live evaluation. Uploads are checked for extension, size,
MP3 signature and decodability, and stored under random names per user. No secrets are ever sent to
the frontend; `.env` files are git-ignored.

## Known limitations

- Chord recognition is a model prediction, not a verified transcription; the UI says so and flags
  low-confidence segments as *uncertain*.
- Live recognition has been validated on synthesised guitar, not yet on a set of real recordings;
  strum the full chord and use headphones for *Play along* (speakers make the microphone hear the
  recording).
- Without Redis, queued analyses are lost if Django restarts; such songs are marked failed after
  30 minutes and can be re-analyzed with one click.
- Essentia is unavailable on native Windows; librosa is used instead.

## Credits

BTC © 2019 Jonggwon Park (MIT). Beat This! © CPJKU (MIT). Fonts: Manrope and Inter (OFL).
