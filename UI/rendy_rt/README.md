# Rendy UI

This package is the React + TypeScript + Vite chat UI for Rendy. It also ships the Express proxy used to keep browser traffic same-origin while forwarding Flowise requests over Render's private network.

## Runtime Shape

- [`server.js`](server.js): development entrypoint. Starts Express, mounts `/api`, and runs Vite in middleware mode.
- [`prod-server.js`](prod-server.js): production entrypoint. Serves `dist/` plus the same `/api` routes.
- [`api/flowiseProxy.js`](api/flowiseProxy.js): proxies Flowise prediction, feedback, and upload-file requests.
- [`src/App.tsx`](src/App.tsx): main chat UI, downloads, citations, artifacts, feedback, attachments, and recent-chat state.

## Requirements

- Node.js `>=20.19.0`
- npm `>=10.9.0`

Those versions come directly from [`package.json`](package.json).

## Render-First Workflow

This UI is intended to be deployed as the `rendy-web` Render service. The normal workflow is:

1. Update code in [`UI/rendy_rt/`](.)
2. Push the commit to the repo/branch connected to Render
3. Or change env vars on the `rendy-web` service in Render
4. Let Render rebuild and redeploy the service

The Blueprint already configures Render to use:

- `rootDir: UI/rendy_rt`
- `buildCommand: npm ci && npm run build`
- `startCommand: npm run start`

In other words, most day-to-day UI changes should be thought of as Render deploys, not local shell sessions.

## Render Environment

On Render, configure these on the `rendy-web` service.

### Required for the default proxied deployment

```bash
VITE_FLOWISE_PROXY_BASE=/api/flowise
VITE_FLOWISE_CHATFLOW_ID=<assistant-chatflow-id>
VITE_FLOWISE_STREAMING=true
FLOWISE_INTERNAL_HOSTPORT=<hostport from rendy-orchestration>
```

### Optional overrides

```bash
# Direct browser-to-Flowise prediction mode
# When set, predictions bypass the Express proxy.
VITE_FLOWISE_API_URL=http://localhost:3000/api/v1/prediction/<chatflow-id>

# Optional direct feedback override
VITE_FLOWISE_FEEDBACK_URL=http://localhost:3000/api/v1/feedback

# Comma-separated component names used when filtering the OpenAI status summary
VITE_OPENAI_API_COMPONENTS=Chat Completions,Responses,Embeddings,Files,Fine-tuning,Moderations,Batch

# Label stored with recent prompts and restored chat history
VITE_LLM_PROVIDER=OpenAI

# Server-side JSON body limit for the Flowise proxy
FLOWISE_PROXY_JSON_LIMIT=25mb
```

## What Triggers A New UI Deploy

- Push a commit to the branch linked to the Render service
- Change env vars on the `rendy-web` service
- Manually redeploy from Render if you need to rerun the same revision

That is the main operational path for this UI.

## Render Runtime Notes

- `npm run start` runs [`prod-server.js`](prod-server.js), which serves `dist/` plus the Express `/api` routes.
- The browser talks to `/api/flowise` on the same origin.
- [`api/flowiseProxy.js`](api/flowiseProxy.js) forwards those requests to Flowise over Render's private network via `FLOWISE_INTERNAL_HOSTPORT`.

## Current UI Features

- Same-origin Flowise proxy for prediction, feedback, and uploaded-file retrieval
- Streaming responses with a stop button
- Suggestion cards and left-rail shortcuts defined in [`src/App.tsx`](src/App.tsx)
- Recent chat history stored in browser `localStorage`
- Chat/session persistence keyed by chatflow ID
- Attachments in the composer: up to 4 files, 2 MB each
- Citations, artifacts, and agent-reasoning panels when Flowise returns them
- Response downloads and full-thread downloads as `.txt`, `.md`, `.rtf`, and `.pdf`
- Thumbs-up/thumbs-down feedback for assistant messages with Flowise metadata
- A top-right status chip that polls the OpenAI status summary API, even though the visible label text currently reads `Render API`

## Files Worth Editing First

- [`src/App.tsx`](src/App.tsx): prompt cards, sidebar links, greeting, placeholder text, status-chip label, and interaction behavior
- [`src/App.css`](src/App.css): layout, theme, spacing, and responsive styling
- [`public/`](public): logos and other static assets

## Optional Local Development

Local development is still available when you need to iterate outside Render.

Create `UI/rendy_rt/.env.local`. `npm run dev` reads it through `node --env-file=.env.local server.js`.

```bash
VITE_FLOWISE_PROXY_BASE=/api/flowise
VITE_FLOWISE_CHATFLOW_ID=<assistant-chatflow-id>
VITE_FLOWISE_STREAMING=true
FLOWISE_INTERNAL_HOSTPORT=localhost:3000
```

Then run:

```bash
cd UI/rendy_rt
npm install
npm run dev
```

Useful distinction:

- `npm run dev` and `npm run start` use `FLOWISE_INTERNAL_HOSTPORT`
- `vite preview` and the proxy config in [`vite.config.ts`](vite.config.ts) use `FLOWISE_PROXY_TARGET`, which defaults to `http://localhost:3000`
- `npm run dev` listens on `PORT` or `5173`
- `npm run start` listens on `PORT` or `4173`

## Troubleshooting

| Issue | Likely Cause |
| --- | --- |
| `Flowise chatflow is not configured` | `VITE_FLOWISE_CHATFLOW_ID` is blank or the service was not redeployed after setting it. |
| `Unable to reach Flowise prediction endpoint` | `FLOWISE_INTERNAL_HOSTPORT` is wrong, Flowise is down, or the private-network target is unreachable. |
| `vite preview` works differently from `npm run dev` | They do not use the same proxy path. `vite preview` uses `FLOWISE_PROXY_TARGET`; `npm run dev` uses the Express proxy and `FLOWISE_INTERNAL_HOSTPORT`. |
| Downloads fail or blank PDFs appear | Large markdown snapshots can take a moment; the PDF path renders off-screen HTML through `html2canvas` and `jsPDF`. |
| Recent chats disappear | They live in browser `localStorage`; clearing site storage resets them. |

## Render Deployment Notes

In Render, the usual setup is:

- `FLOWISE_INTERNAL_HOSTPORT` from the `rendy-orchestration` service
- `VITE_FLOWISE_PROXY_BASE=/api/flowise`
- `VITE_FLOWISE_CHATFLOW_ID=<assistant-chatflow-id>`
- `VITE_FLOWISE_STREAMING=true`

That keeps the browser on one origin while the UI service forwards Flowise traffic internally.
