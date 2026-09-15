# Web Dev Quickstart

## 1) Backend API

From repository root:

```bash
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

Optional backend `.env` (security + managed AI):

```bash
APP_ENV=development
JWT_SECRET_KEY=replace-with-a-32-plus-character-secret
MASTER_ENCRYPTION_KEY=replace-with-fernet-key
CORS_ORIGINS=http://localhost:5173
ALLOW_LAN_ORIGINS=1
ENFORCE_STARTUP_VALIDATION=1
ENABLE_SECURITY_HEADERS=1
ENABLE_HSTS=0
PERMISSIONS_POLICY_CAMERA=self
TRUST_PROXY_IP_HEADERS=0
RATE_LIMIT_WINDOW_SECONDS=60
AUTH_LOGIN_RATE_LIMIT=12
AUTH_SIGNUP_RATE_LIMIT=6
AI_CHAT_RATE_LIMIT=40
CREDENTIAL_WRITE_RATE_LIMIT=20
ENTERPRISE_OPENAI_API_KEY=
ENTERPRISE_ANTHROPIC_API_KEY=
ENTERPRISE_GEMINI_API_KEY=
ENTERPRISE_OLLAMA_API_KEY=
```

Optional: create/update a local test account for authenticated feature work:

```bash
cd backend
python tools/seed_dev_user.py --email demo@example.com --password DevPass1234 --force-password-reset
```

## 2) Web App

In another terminal:

```bash
cd web
npm install
npm run dev
```

By default, the frontend points to `http://localhost:8000`.
If `VITE_API_URL` is unset, it now resolves to `http(s)://<current-host>:8000`, which works for LAN access.

Optional override:

```bash
# web/.env
VITE_API_URL=http://localhost:8000
VITE_LANDING_DEMO_URL=/landing-demo.gif
```

## LAN mode checklist

1. Run backend on all interfaces:

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

2. Run frontend normally (`host: true` is enabled in Vite config):

```bash
cd web
npm run dev
```

3. Open app from laptop: `http://<dev-machine-ip>:5173`

4. Camera/eye-tracking caveat:
- `getUserMedia` requires secure context.
- `localhost` is special-cased secure.
- Plain `http://<LAN-IP>` often blocks camera.
- Use HTTPS for LAN origin (recommended), or a dev browser override when testing.

## 3) Supported flow right now

- Landing page with floating demo and guest/app/auth entry points
- Sign up and log in against backend JWT auth endpoints
- Save encrypted BYOK provider keys (OpenAI/Anthropic/Gemini/Ollama)
- Open app in guest mode or signed-in mode
- Upload `.pdf` or `.epub`
- Parse in background job
- Poll job status
- Load parsed words/chapters/page map/footnotes
- RSVP reading with keyboard controls
- Save and restore reading progress
