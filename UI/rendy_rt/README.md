# Rendy UI (TFO Edition)

This project powers the TFO-focused Rendy Assistant experience. It uses React + TypeScript + Vite, with defaults and cards tailored for Solutions Architects. The Express API under `UI/rendy_rt/api/` handles the Flowise proxy endpoint for this flavor of the UI.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 20.19+ or 22.12+** | Vite 7 requires it. Use `nvm install 20 && nvm use 20` if needed. |
| **npm 10+** | Bundled with Node 20+. |

---

## 2. Project Structure

```
rendy_rt/
├── api/                 # Express router (Flowise proxy)
├── public/
├── src/
│   ├── App.tsx          # Shell + Rendy-specific prompts/cards
│   ├── App.css
│   ├── hooks/           # useRecentPrompts, useChatSession
│   ├── utils/           # Markdown helpers, etc.
│   └── ...
├── vite.config.ts
├── package.json
└── README.md
```

**Key features:**

1. **Render API Status Chip** – Shows the live indicator from `status.openai.com`. It updates every five minutes and animates green/yellow/red.
2. **Updated Prompt Grid** – Suggestion cards cover Architecture, Blueprints, Best Practices, Services, Networking, and Troubleshooting.
3. **Browser-Only Recents** – Recent prompt history is stored in browser `localStorage`, not Postgres.
4. **Rich Exports** – Every assistant response can be downloaded as TXT/Markdown/RTF or a styled PDF that mirrors the in-app look (jsPDF + html2canvas under the hood).

### Copy & Cards Quick Reference

| Area | Default text | Where to edit |
|------|--------------|---------------|
| Workspace header | `Rendy` title + `Render - Assistant` subhead | Header markup inside `src/App.tsx` (search for `Render - Assistant`). |
| Status chip label | `Render API · {status}` | `status-chip` markup in `src/App.tsx` (search for `Render API ·`). |
| Prompt cards | Architecture / Blueprints / Best Practices / Services / Networking / Troubleshooting | `suggestionCards` array near the top of `src/App.tsx`. |

---

## 3. Environment Configuration

Create `UI/rendy_rt/.env.local` with:

```bash
# Recommended: local/server-side Flowise proxy
VITE_FLOWISE_PROXY_BASE=/api/flowise
VITE_FLOWISE_CHATFLOW_ID=<chatflow-uuid>

# Optional direct Flowise override (legacy / non-proxied mode)
# VITE_FLOWISE_API_URL=https://your-flowise-host/api/v1/prediction/<chatflowId>
# VITE_FLOWISE_FEEDBACK_URL=https://your-flowise-host/api/v1/feedback

# Optional overrides
VITE_FLOWISE_STREAMING=true

# Render/private-network Flowise proxy target (server-side only)
FLOWISE_INTERNAL_HOSTPORT=localhost:3000
```

*In Render, the recommended setup is `FLOWISE_INTERNAL_HOSTPORT` from the Flowise service plus `VITE_FLOWISE_CHATFLOW_ID` on the UI service. That keeps browser traffic same-origin and sends Flowise traffic over Render's private network.*

---

## 4. Install & Run

```bash
cd UI/rendy_rt
npm install
npm run dev
```

`npm run dev` launches Vite (default `http://localhost:5173/`) and mounts the Express API so `/api/flowise/...` routes work without a separate backend.

### Production build

```bash
npm run build
npm run preview   # optional sanity check
```

The build emits to `UI/rendy_rt/dist/`. Production runs through `prod-server.js`, which serves the UI and the Express API route under `/api/flowise`.

---

## 5. Feature Notes

### Render API Status Chip

* Polls `https://status.openai.com/api/v2/summary.json` every five minutes (`OPENAI_STATUS_POLL_INTERVAL`).
* Narrows the component list down to `api.openai.com` services, collapses them into one indicator (green, yellow, red), and shows a textual description (`Available`, `Degraded`, `Offline`, or fallback text).
* Network errors mark the pill yellow temporarily; the previous successful payload is kept so the UI never goes blank.

### Response Downloads (PDF)

* TXT → Markdown – stripped formatting.
* RTF – styled via a lightweight converter.
* **PDF** – Renders the actual Markdown (headings, tables, code blocks) into an off-screen container using the app’s dark theme, snapshots it with `html2canvas`, and streams it into jsPDF. Large outputs spill onto additional pages automatically.

### Markdown Rendering Hygiene

* Helpers under `src/utils/markdownRenderer.tsx` strip stray `TEXT` placeholders that Flowise sometimes emits, preventing code blocks from duplicating the word “TEXT”.

---

## 6. Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + Express proxy with HMR |
| `npm run build` | Type check + production bundle |
| `npm run preview` | Serve the `dist/` bundle locally |
| `npm run start` | Run `prod-server.js` (serves `dist/` + `/api` routes) |

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| Node version warning | Upgrade to Node >= 20.19. |
| PDF downloads blank | Confirm `html2canvas` loaded (no CSP issues). Large responses may take a second to rasterize. |
| Recent prompts missing | Confirm the browser allows `localStorage` and clear site storage if the stored recents are stale or malformed. |
| Chat replies fail immediately on a fresh deploy | Create/import a Flowise chatflow, set `VITE_FLOWISE_CHATFLOW_ID`, and redeploy the UI service. |

---

Keep this README updated as workflow changes land (new cards, env vars, or download formats).
