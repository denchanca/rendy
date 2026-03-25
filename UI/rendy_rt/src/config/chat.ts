import type { Message } from '../types'

export const FLOWISE_DIRECT_API_URL =
  typeof import.meta.env.VITE_FLOWISE_API_URL === 'string' ? import.meta.env.VITE_FLOWISE_API_URL.trim() : ''

export const FLOWISE_PROXY_BASE =
  typeof import.meta.env.VITE_FLOWISE_PROXY_BASE === 'string' && import.meta.env.VITE_FLOWISE_PROXY_BASE.trim().length > 0
    ? import.meta.env.VITE_FLOWISE_PROXY_BASE.trim().replace(/\/$/, '')
    : '/api/flowise'

export const FLOWISE_CONFIG_ERROR =
  'Flowise chatflow is not configured yet. Set VITE_FLOWISE_CHATFLOW_ID after creating or importing a chatflow in Flowise.'

export const RENDY_API_URL = FLOWISE_DIRECT_API_URL || `${FLOWISE_PROXY_BASE}/prediction`

export const FLOWISE_STREAMING_ENABLED =
  String(import.meta.env.VITE_FLOWISE_STREAMING ?? 'true').toLowerCase() !== 'false'

export const STREAMING_NOT_SUPPORTED_ERROR = 'FLOWISE_STREAMING_NOT_SUPPORTED'
export const FLOWISE_NO_ANSWER_FALLBACK = 'I could not find a confident answer in Flowise.'
export const FLOWISE_ERROR_FALLBACK = 'I hit an issue reaching Flowise. Try again in a moment or check the API status.'

export const DEFAULT_LLM_PROVIDER = import.meta.env.VITE_LLM_PROVIDER ?? 'OpenAI'
export const AUTOSCROLL_STORAGE_KEY = 'rendy_rt_autoscroll_enabled'
export const LEGACY_AUTOSCROLL_STORAGE_KEY = 'navi_rt_autoscroll_enabled'

export type OpenAIStatusIndicator = 'green' | 'yellow' | 'red' | 'unknown'

export type OpenAIStatusState = {
  indicator: OpenAIStatusIndicator
  description: string
}

export type OpenAIStatusComponent = {
  id?: string
  name: string
  status?: string | null
}

export type OpenAIStatusSummaryResponse = {
  status?: {
    indicator?: string | null
    description?: string | null
  }
  components?: OpenAIStatusComponent[]
}

export const OPENAI_STATUS_SUMMARY_URL = 'https://status.openai.com/api/v2/summary.json'
export const OPENAI_STATUS_POLL_INTERVAL = 5 * 60 * 1000

const DEFAULT_OPENAI_API_COMPONENTS = [
  'Chat Completions',
  'Responses',
  'Embeddings',
  'Files',
  'Fine-tuning',
  'Moderations',
  'Batch',
]

const OPENAI_API_COMPONENT_NAMES = (() => {
  const raw = import.meta.env.VITE_OPENAI_API_COMPONENTS
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  }
  return DEFAULT_OPENAI_API_COMPONENTS
})()

const OPENAI_API_COMPONENT_NAME_SET = new Set(
  OPENAI_API_COMPONENT_NAMES.map((name) => name.trim().toLowerCase()),
)

export const CHATFLOW_ID = (() => {
  const configuredId =
    typeof import.meta.env.VITE_FLOWISE_CHATFLOW_ID === 'string' ? import.meta.env.VITE_FLOWISE_CHATFLOW_ID.trim() : ''
  if (configuredId.length > 0) return configuredId
  const match = FLOWISE_DIRECT_API_URL.match(/\/prediction\/([^/?#]+)/)
  return match ? match[1] : ''
})()

export const CHATFLOW_STORAGE_KEY = CHATFLOW_ID ? `rendy_session_${CHATFLOW_ID}` : 'rendy_session_default'
export const LEGACY_CHATFLOW_STORAGE_KEYS = CHATFLOW_ID ? [`navi_session_${CHATFLOW_ID}`] : ['navi_session_default']

const FLOWISE_PREDICTION_URL = (() => {
  if (!FLOWISE_DIRECT_API_URL) return null
  try {
    return new URL(FLOWISE_DIRECT_API_URL)
  } catch {
    if (typeof window !== 'undefined') {
      try {
        return new URL(FLOWISE_DIRECT_API_URL, window.location.origin)
      } catch {
        return null
      }
    }
    return null
  }
})()

const buildFileEndpoint = (url: URL) => {
  const match = url.pathname.match(/^(.*)\/prediction\/[^/]+$/)
  const basePath = match ? match[1] : url.pathname.replace(/\/$/, '')
  const normalized = basePath && basePath.length > 0 ? basePath : ''
  const joined = `${normalized}/get-upload-file`
  return `${url.origin}${joined.startsWith('/') ? joined : `/${joined}`}`
}

const FLOWISE_FILE_ENDPOINT_STATIC = FLOWISE_PREDICTION_URL
  ? buildFileEndpoint(FLOWISE_PREDICTION_URL)
  : `${FLOWISE_PROXY_BASE}/get-upload-file`

export const getFlowiseFileEndpoint = () => {
  if (FLOWISE_FILE_ENDPOINT_STATIC) return FLOWISE_FILE_ENDPOINT_STATIC
  if (typeof window === 'undefined') return ''
  try {
    const runtimeUrl = new URL(RENDY_API_URL, window.location.origin)
    return buildFileEndpoint(runtimeUrl)
  } catch {
    return '/api/v1/get-upload-file'
  }
}

export const selectOpenAIComponents = (components?: OpenAIStatusComponent[]) => {
  if (!components || components.length === 0) return []
  if (OPENAI_API_COMPONENT_NAME_SET.size === 0) return components
  return components.filter((component) => {
    if (!component?.name) return false
    return OPENAI_API_COMPONENT_NAME_SET.has(component.name.trim().toLowerCase())
  })
}

const deriveComponentIndicator = (status?: string | null): OpenAIStatusIndicator => {
  switch ((status ?? '').toLowerCase()) {
    case 'operational':
      return 'green'
    case 'major_outage':
      return 'red'
    case 'degraded_performance':
    case 'partial_outage':
    case 'under_maintenance':
      return 'yellow'
    default:
      return 'unknown'
  }
}

export const deriveAggregateOpenAIIndicator = (components: OpenAIStatusComponent[]): OpenAIStatusIndicator => {
  if (components.length === 0) return 'unknown'
  let aggregate: OpenAIStatusIndicator = 'green'
  for (const component of components) {
    const indicator = deriveComponentIndicator(component.status)
    if (indicator === 'red') return 'red'
    if (indicator === 'yellow' && aggregate === 'green') aggregate = 'yellow'
    if (indicator === 'unknown' && aggregate === 'green') aggregate = 'unknown'
  }
  return aggregate
}

export const deriveSummaryIndicator = (indicator?: string | null): OpenAIStatusIndicator => {
  switch ((indicator ?? '').toLowerCase()) {
    case 'none':
      return 'green'
    case 'minor':
    case 'maintenance':
      return 'yellow'
    case 'major':
    case 'critical':
      return 'red'
    default:
      return 'unknown'
  }
}

const OPENAI_INDICATOR_LABEL: Record<OpenAIStatusIndicator, string> = {
  green: 'Available',
  yellow: 'Degraded',
  red: 'Offline',
  unknown: 'Degraded',
}

export const buildOpenAIStatusDescription = (indicator: OpenAIStatusIndicator) =>
  OPENAI_INDICATOR_LABEL[indicator] ?? OPENAI_INDICATOR_LABEL.unknown

export const initialAssistantMessage: Message = {
  id: 'intro',
  role: 'assistant',
  content: "Hi, I'm Rendy. Let's begin.",
  createdAt: Date.now(),
}

export const suggestionCards = [
  {
    title: 'Architecture',
    prompt:
      'Design a production-ready Render architecture for a multi-service app with a web service, background worker, managed Postgres, and private networking.',
  },
  {
    title: 'Blueprints',
    prompt:
      'Show me how to structure a Render Blueprint for a monorepo with separate services, rootDir settings, environment variables, disks, and a managed Postgres database.',
  },
  {
    title: 'Best Practices',
    prompt:
      'What are the best practices for deploying and operating apps on Render, including health checks, preview environments, secrets, disks, and zero-downtime deploys?',
  },
  {
    title: 'Services',
    prompt:
      'Explain how to structure Render web services, background workers, cron jobs, and static sites for a multi-tier application, and when to use each one.',
  },
  {
    title: 'Networking',
    prompt:
      'Show me how networking works on Render, including internal service-to-service communication, custom domains, TLS, environment isolation, and secure public exposure.',
  },
  {
    title: 'Troubleshooting',
    prompt:
      'Help me troubleshoot a failing Render deploy by reviewing build logs, startup errors, health checks, environment variables, and service-to-service connectivity.',
  },
]

export const navShortcuts = [
  { label: 'render.com', url: 'https://render.com/' },
  { label: 'dashboard', url: 'https://dashboard.render.com/' },
  { label: 'documentation', url: 'https://render.com/docs' },
  { label: 'changelog', url: 'https://render.com/changelog' },
  { label: 'blog', url: 'https://render.com/blog' },
  { label: 'platform', url: 'https://render.com/platform' },
  { label: 'about us', url: 'https://render.com/about' },
]
