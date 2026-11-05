# Deploying AI Army Command

The backend serves both the API and the built frontend, so every option below is a single deployment.

## 0. Configure (all options)

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | Free signup at `https://openrouter.ai/keys`. Free `:free` models cost nothing. |
| `GEMINI_API_KEY` | for Barracks | Free at `https://aistudio.google.com`. Powers Gemini agents. |
| `OLLAMA_URL` | for Barracks | Default `http://localhost:11434`. Only needed for local-model agents. |
| `AI_ARMY_WORKDIR` | for Barracks | Sandbox for agent file/shell tools. Defaults to `~/workspace/ai-army/work`. |
| `PORT` | no | Default 3001 (3000 in Docker). |
| `NODE_ENV` | no | Set `production` on servers. |
| `ALLOWED_ORIGINS` | no | Only if the frontend is hosted on a different origin than the API. |

## 1. Local

```bash
npm run install:all
npm run build
npm start   # http://localhost:3001
```

Dev mode (hot reload): `npm run dev:backend` + `npm run dev:frontend` (http://localhost:5173, API proxied).

## 2. Docker (any machine)

```bash
docker compose up --build -d
# http://localhost:3000
```

Custom tiles persist via the `./backend/src/data` volume.

## 3. Remote access — pick one

### A. Cloudflare Tunnel (recommended for a home machine)
No open ports, free, HTTPS automatic:
```bash
cloudflared tunnel --url http://localhost:3000
# or a named tunnel for a stable address
```
Your ThinkPad stays the server; Cloudflare gives you a public HTTPS URL.

### B. VPS + Caddy (your own domain)
Point DNS at the VPS, then:
```
yourdomain.com {
    reverse_proxy localhost:3000
}
```
Caddy provisions HTTPS automatically.

### C. Railway / Render / Fly.io
- Connect the repo, set the env vars in their dashboard, deploy from the Dockerfile.
- Set `NODE_ENV=production`.

## Security checklist (do this before exposing remotely)

> This build has **no login gate**. Anyone with the URL can use the dashboard and spend your OpenRouter key. Only share the tunnel URL with people you trust.

- [ ] `NODE_ENV=production`.
- [ ] HTTPS in front (tunnel / Caddy / platform).
- [ ] `.env` is never committed (it's in `.gitignore`).
- [ ] API is throttled (180 req / min).
- [ ] Helmet headers on; CORS locked via `ALLOWED_ORIGINS` if the frontend lives elsewhere.

## What the server never does

- The OpenRouter key never leaves the server — the browser only ever sees streamed answer text.
- No database, no tracking, no analytics. Custom tiles live in `backend/src/data/custom-tiles.json`.
