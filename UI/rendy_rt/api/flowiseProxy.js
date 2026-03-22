import express from 'express'
import { Readable } from 'node:stream'

const router = express.Router()

const DEFAULT_JSON_LIMIT = process.env.FLOWISE_PROXY_JSON_LIMIT ?? '25mb'
const FLOWISE_CHATFLOW_ERROR =
  'Flowise chatflow is not configured. Set VITE_FLOWISE_CHATFLOW_ID and redeploy the UI.'
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const getFlowiseHostport = () => (process.env.FLOWISE_INTERNAL_HOSTPORT ?? '').trim()
const getConfiguredChatflowId = () => (process.env.VITE_FLOWISE_CHATFLOW_ID ?? '').trim()

const getFlowiseBaseUrl = () => {
  const hostport = getFlowiseHostport()
  if (!hostport) {
    throw new Error('FLOWISE_INTERNAL_HOSTPORT is not configured.')
  }
  return `http://${hostport}`
}

const buildUpstreamUrl = (pathname, searchParams) => {
  const url = new URL(pathname, getFlowiseBaseUrl())
  if (searchParams) {
    url.search = searchParams.toString()
  }
  return url
}

const appendQueryParams = (searchParams, query) => {
  for (const [key, rawValue] of Object.entries(query)) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value))
        }
      }
      continue
    }
    if (rawValue !== undefined && rawValue !== null) {
      searchParams.append(key, String(rawValue))
    }
  }
}

const applyUpstreamHeaders = (res, headers) => {
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
    res.setHeader(key, value)
  })
}

const pipeUpstreamResponse = async (upstream, res) => {
  res.status(upstream.status)
  applyUpstreamHeaders(res, upstream.headers)

  if (!upstream.body) {
    const text = await upstream.text()
    res.end(text)
    return
  }

  res.flushHeaders()
  Readable.fromWeb(upstream.body).pipe(res)
}

const proxyJsonRequest = async (req, res, pathname, body) => {
  const upstream = await fetch(buildUpstreamUrl(pathname), {
    method: req.method,
    headers: {
      Accept: req.get('accept') ?? '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })

  await pipeUpstreamResponse(upstream, res)
}

router.post('/prediction', express.json({ limit: DEFAULT_JSON_LIMIT }), async (req, res) => {
  const chatflowId = getConfiguredChatflowId()
  if (!chatflowId) {
    res.status(503).json({ error: FLOWISE_CHATFLOW_ERROR })
    return
  }

  try {
    await proxyJsonRequest(req, res, `/api/v1/prediction/${encodeURIComponent(chatflowId)}`, req.body)
  } catch (error) {
    console.error('Flowise prediction proxy failed.', error)
    res.status(502).json({ error: 'Unable to reach Flowise prediction endpoint.' })
  }
})

router.post('/feedback', express.json({ limit: '1mb' }), async (req, res) => {
  const chatflowId = getConfiguredChatflowId()
  if (!chatflowId) {
    res.status(503).json({ error: FLOWISE_CHATFLOW_ERROR })
    return
  }

  const payload =
    req.body && typeof req.body === 'object'
      ? { ...req.body, chatflowid: req.body.chatflowid ?? chatflowId }
      : { chatflowid: chatflowId }

  try {
    await proxyJsonRequest(req, res, '/api/v1/feedback', payload)
  } catch (error) {
    console.error('Flowise feedback proxy failed.', error)
    res.status(502).json({ error: 'Unable to reach Flowise feedback endpoint.' })
  }
})

router.get('/get-upload-file', async (req, res) => {
  const searchParams = new URLSearchParams()
  appendQueryParams(searchParams, req.query)

  if (!searchParams.get('chatflowId')) {
    const chatflowId = getConfiguredChatflowId()
    if (!chatflowId) {
      res.status(503).json({ error: FLOWISE_CHATFLOW_ERROR })
      return
    }
    searchParams.set('chatflowId', chatflowId)
  }

  try {
    const upstream = await fetch(buildUpstreamUrl('/api/v1/get-upload-file', searchParams), {
      headers: {
        Accept: req.get('accept') ?? '*/*',
      },
    })

    await pipeUpstreamResponse(upstream, res)
  } catch (error) {
    console.error('Flowise file proxy failed.', error)
    res.status(502).json({ error: 'Unable to reach Flowise file endpoint.' })
  }
})

export default router
