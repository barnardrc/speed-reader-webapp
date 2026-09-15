# Speed Reader Web App

A web-first rapid-serial-visual-presentation (RSVP) reader with document parsing, reading-progress persistence, optional AI assistance, and an experimental browser-based gaze interface.

## Architecture

- `backend/` — FastAPI, SQLAlchemy, authentication, document processing, progress storage, and an AI-provider proxy
- `web/` — React, TypeScript, Vite, TanStack Query, and Zustand
- `docs/` — local-development notes

The backend accepts user-provided EPUB and PDF files and stores runtime state locally by default. No books, user accounts, databases, credentials, or generated runtime data are included in this repository.

## Project status

This is an active prototype, not a production-ready hosted service. Authentication, encrypted bring-your-own-key storage, rate limits, and security headers are represented in the code, but a real deployment still needs independent security review, managed secrets, HTTPS, backups, monitoring, database migrations, and a documented data-retention policy.

## Local development

### Backend

```bash
cd backend
python -m venv .venv
```

Activate the environment and install dependencies:

```bash
python -m pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env`, replace its development secrets, and start the API:

```bash
uvicorn app.main:app --reload --port 8000
```

The health endpoint is available at `http://localhost:8000/health`.

For local feature development, create a disposable account:

```bash
python tools/seed_dev_user.py --email demo@example.com --password "choose-a-local-password" --force-password-reset
```

Never reuse that password or expose a development database.

### Frontend

```bash
cd web
npm ci
npm run dev
```

The frontend defaults to a backend on port `8000`. Override it with a local `web/.env` file:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_LANDING_DEMO_URL=/landing-demo.gif
```

## LAN and gaze testing

Start the backend with `--host 0.0.0.0` and the Vite development server with its configured network host, then connect from another device on the same trusted network.

Browser camera APIs normally require a secure context. Use an HTTPS development origin for gaze testing; do not weaken browser security settings on a normal browsing profile. Camera frames are used by the experimental gaze interface, so obtain consent from anyone who may appear in view.

## Configuration

Important backend variables are documented in `backend/.env.example`. In particular:

- `JWT_SECRET_KEY` signs access tokens.
- `MASTER_ENCRYPTION_KEY` protects stored provider credentials.
- `CORS_ORIGINS` controls allowed web origins.
- `ENFORCE_STARTUP_VALIDATION=1` makes unsafe production-style configuration fail closed.
- `ENTERPRISE_*_API_KEY` values are optional server-managed provider credentials.

Environment files are ignored and must never be committed.

## Privacy and document handling

- Upload only documents you are authorized to possess and process.
- Uploaded documents, extracted text, user records, progress, and credentials are private application data.
- The local `data/` directory is ignored by Git.
- AI requests may send selected text to the provider configured by the user or operator; review that provider's data policy first.
- Delete local runtime data when it is no longer needed.

## Checks

```bash
python -m compileall -q backend
cd web
npm ci
npm run build
```

GitHub Actions runs the backend syntax check and production frontend build for each push and pull request.

## Additional documentation

- [Web development quickstart](docs/web-dev-quickstart.md)

## License

No open-source license has been selected. Until one is added, standard copyright applies.
