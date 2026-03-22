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

## Environment

Create `UI/rendy_rt/.env.local` for local work. `npm run dev` reads it through `node --env-file=.env.local server.js`.

### Required for the default proxied setup

```bash
VITE_FLOWISE_PROXY_BASE=/api/flowise
VITE_FLOWISE_CHATFLOW_ID=<assistant-chatflow-id>
VITE_FLOWISE_STREAMING=true
FLOWISE_INTERNAL_HOSTPORT=localhost:3000
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

# Only used by `vite preview` or raw Vite proxying, not by `npm run dev`
FLOWISE_PROXY_TARGET=http://localhost:3000
```

## Install And Run

```bash
cd UI/rendy_rt
npm install
npm run dev
```

Default local port:

- `npm run dev` listens on `PORT` or `5173`
- `npm run start` listens on `PORT` or `4173`

## Build And Serve

```bash
npm run build
npm run preview
npm run start
```

What those commands actually do:

- `npm run build`: TypeScript build plus Vite production bundle
- `npm run preview`: Vite preview server. Its `/api` proxy comes from [`vite.config.ts`](vite.config.ts), so it uses `FLOWISE_PROXY_TARGET`
- `npm run start`: [`prod-server.js`](prod-server.js), which serves `dist/` and the Express `/api` routes in one process

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

## Troubleshooting

| Issue | Likely Cause |
| --- | --- |
| `Flowise chatflow is not configured` | `VITE_FLOWISE_CHATFLOW_ID` is blank or the UI was not restarted/redeployed after setting it. |
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
