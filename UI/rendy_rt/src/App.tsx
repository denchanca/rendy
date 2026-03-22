import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import type {
  AgentReasoningEntry,
  Attachment,
  Citation,
  FlowiseArtifact,
  FlowiseResponse,
  Message,
  RecentPrompt,
} from './types'
import './App.css'
import {
  ClipboardIcon,
  DownloadIcon,
  PaperclipIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from './icons'
import { useRecentPrompts } from './hooks/useRecentPrompts'
import { useChatSession } from './hooks/useChatSession'

const FLOWISE_DIRECT_API_URL =
  typeof import.meta.env.VITE_FLOWISE_API_URL === 'string' ? import.meta.env.VITE_FLOWISE_API_URL.trim() : ''
const FLOWISE_PROXY_BASE =
  typeof import.meta.env.VITE_FLOWISE_PROXY_BASE === 'string' && import.meta.env.VITE_FLOWISE_PROXY_BASE.trim().length > 0
    ? import.meta.env.VITE_FLOWISE_PROXY_BASE.trim().replace(/\/$/, '')
    : '/api/flowise'
const FLOWISE_CONFIG_ERROR =
  'Flowise chatflow is not configured yet. Set VITE_FLOWISE_CHATFLOW_ID after creating or importing a chatflow in Flowise.'

const RENDY_API_URL = FLOWISE_DIRECT_API_URL || `${FLOWISE_PROXY_BASE}/prediction`

const FLOWISE_STREAMING_ENABLED =
  String(import.meta.env.VITE_FLOWISE_STREAMING ?? 'true').toLowerCase() !== 'false'
const STREAMING_NOT_SUPPORTED_ERROR = 'FLOWISE_STREAMING_NOT_SUPPORTED'
const FLOWISE_NO_ANSWER_FALLBACK = 'I could not find a confident answer in Flowise.'
const FLOWISE_ERROR_FALLBACK = 'I hit an issue reaching Flowise. Try again in a moment or check the API status.'
const OPENAI_STATUS_SUMMARY_URL = 'https://status.openai.com/api/v2/summary.json'
const OPENAI_STATUS_POLL_INTERVAL = 5 * 60 * 1000
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
  OPENAI_API_COMPONENT_NAMES.map((name) => name.toLowerCase()),
)

const DEFAULT_LLM_PROVIDER = import.meta.env.VITE_LLM_PROVIDER ?? 'OpenAI'
const AUTOSCROLL_STORAGE_KEY = 'rendy_rt_autoscroll_enabled'
const LEGACY_AUTOSCROLL_STORAGE_KEY = 'navi_rt_autoscroll_enabled'

type OpenAIStatusIndicator = 'green' | 'yellow' | 'red' | 'unknown'

type OpenAIStatusState = {
  indicator: OpenAIStatusIndicator
  description: string
}

type OpenAIStatusComponent = {
  id?: string
  name: string
  status?: string | null
}

type OpenAIStatusSummaryResponse = {
  status?: {
    indicator?: string | null
    description?: string | null
  }
  components?: OpenAIStatusComponent[]
}

const deriveFeedbackUrl = (apiUrl: string) => {
  try {
    const url = new URL(apiUrl)
    const segments = url.pathname.split('/').filter(Boolean)
    const predictionIndex = segments.lastIndexOf('prediction')

    if (predictionIndex !== -1) {
      const baseSegments = segments.slice(0, predictionIndex)
      url.pathname = `/${baseSegments.join('/')}/feedback`
    } else {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/feedback`
    }

    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return apiUrl.replace(/\/prediction\/[^/]+$/, '') + '/feedback'
  }
}

const FEEDBACK_URL =
  import.meta.env.VITE_FLOWISE_FEEDBACK_URL && import.meta.env.VITE_FLOWISE_FEEDBACK_URL.trim().length > 0
    ? import.meta.env.VITE_FLOWISE_FEEDBACK_URL
    : FLOWISE_DIRECT_API_URL
      ? deriveFeedbackUrl(RENDY_API_URL)
      : `${FLOWISE_PROXY_BASE}/feedback`
const CHATFLOW_ID = (() => {
  const configuredId =
    typeof import.meta.env.VITE_FLOWISE_CHATFLOW_ID === 'string' ? import.meta.env.VITE_FLOWISE_CHATFLOW_ID.trim() : ''
  if (configuredId.length > 0) return configuredId
  const match = FLOWISE_DIRECT_API_URL.match(/\/prediction\/([^/?#]+)/)
  return match ? match[1] : ''
})()
const CHATFLOW_STORAGE_KEY = CHATFLOW_ID ? `rendy_session_${CHATFLOW_ID}` : 'rendy_session_default'
const LEGACY_CHATFLOW_STORAGE_KEYS = CHATFLOW_ID ? [`navi_session_${CHATFLOW_ID}`] : ['navi_session_default']
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

const getFlowiseFileEndpoint = () => {
  if (FLOWISE_FILE_ENDPOINT_STATIC) return FLOWISE_FILE_ENDPOINT_STATIC
  if (typeof window === 'undefined') return ''
  try {
    const runtimeUrl = new URL(RENDY_API_URL, window.location.origin)
    return buildFileEndpoint(runtimeUrl)
  } catch {
    return '/api/v1/get-upload-file'
  }
}

const normalizeComponentName = (value: string) => value.trim().toLowerCase()

const selectOpenAIComponents = (components?: OpenAIStatusComponent[]) => {
  if (!components || components.length === 0) return []
  if (OPENAI_API_COMPONENT_NAME_SET.size === 0) return components
  return components.filter((component) => {
    if (!component?.name) return false
    return OPENAI_API_COMPONENT_NAME_SET.has(normalizeComponentName(component.name))
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

const deriveAggregateOpenAIIndicator = (components: OpenAIStatusComponent[]): OpenAIStatusIndicator => {
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

const deriveSummaryIndicator = (indicator?: string | null): OpenAIStatusIndicator => {
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

const buildOpenAIStatusDescription = (indicator: OpenAIStatusIndicator) =>
  OPENAI_INDICATOR_LABEL[indicator] ?? OPENAI_INDICATOR_LABEL.unknown

const initialAssistantMessage: Message = {
  id: 'intro',
  role: 'assistant',
  content: "Hi, I'm Rendy. Let's begin.",
  createdAt: Date.now(),
}

const createMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Math.random().toString(36).slice(2, 10)}`

const suggestionCards = [
  {
    title: 'Architecture',
    prompt: 'Design a production-ready Render architecture for a multi-service app with a web service, background worker, managed Postgres, and private networking.',
  },
  {
    title: 'Blueprints',
    prompt: 'Show me how to structure a Render Blueprint for a monorepo with separate services, rootDir settings, environment variables, disks, and a managed Postgres database.',
  },
  {
    title: 'Best Practices',
    prompt: 'What are the best practices for deploying and operating apps on Render, including health checks, preview environments, secrets, disks, and zero-downtime deploys?',
  },
  {
    title: 'Services',
    prompt: 'Explain how to structure Render web services, background workers, cron jobs, and static sites for a multi-tier application, and when to use each one.',
  },
  {
    title: 'Networking',
    prompt: 'Show me how networking works on Render, including internal service-to-service communication, custom domains, TLS, environment isolation, and secure public exposure.',
  },
  {
    title: 'Troubleshooting',
    prompt: 'Help me troubleshoot a failing Render deploy by reviewing build logs, startup errors, health checks, environment variables, and service-to-service connectivity.',
  },
]

const navShortcuts = [
  { label: 'render.com', url: 'https://render.com/' },
  { label: 'dashboard', url: 'https://dashboard.render.com/' },
  { label: 'documentation', url: 'https://render.com/docs' },
  { label: 'changelog', url: 'https://render.com/changelog' },
  { label: 'blog', url: 'https://render.com/blog' },
  { label: 'platform', url: 'https://render.com/platform' },
  { label: 'about us', url: 'https://render.com/about' },
]

const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const formatDateTime = (value: number) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const formatRecentLabel = (value: number) => {
  const now = new Date()
  const date = new Date(value)

  const isSameDay = now.toDateString() === date.toDateString()
  if (isSameDay) {
    return `Today, ${formatTimestamp(value)}`
  }

  const oneDayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.floor((now.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / oneDayMs)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(value)
  }

  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value)
}

const truncatePrompt = (text: string, max = 60) => {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}

const isRendyInsult = (text: string) => {
  if (!text) return false
  const normalized = text.toLowerCase()
  if (!normalized.includes('rendy')) return false
  const insults = ['suck', 'stupid', 'always wrong', 'you are wrong', 'youre wrong', 'terrible', 'awful', 'hate you']
  return insults.some((token) => normalized.includes(token))
}

const extractTextFromNode = (node: ReactNode): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  return ''
}

const convertMarkdownToPlainText = (markdown: string) => {
  if (!markdown) return ''
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/>+\s?/g, '')
    .replace(/\r/g, '')
    .trim()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const escapeRtf = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}')

type TableAlignment = 'left' | 'center' | 'right'

type TableCell = {
  raw: string
  formatted: string
}

type TableRow = {
  cells: TableCell[]
  header: boolean
}

const convertMarkdownToRichText = (markdown: string) => {
  const lines = markdown.split(/\r?\n/)
  const rtfLines: string[] = []
  const header = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f1 Courier New;}}'

  const applyInlineFormatting = (input: string) => {
    let result = escapeRtf(input)
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    result = result.replace(/`([^`]+)`/g, (_match, code) => `\\f1 ${code}\\f0`)
    result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => `\\b ${text}\\b0`)
    result = result.replace(/__([^_]+)__/g, (_match, text) => `\\b ${text}\\b0`)
    result = result.replace(/\*([^*]+)\*/g, (_match, text) => `\\i ${text}\\i0`)
    result = result.replace(/_([^_]+)_/g, (_match, text) => `\\i ${text}\\i0`)
    return result
  }

  const isTableRow = (value: string) => {
    if (!value || !value.includes('|')) return false
    if (/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(value)) return false
    return true
  }

  const isSeparatorRow = (value: string) => /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(value)

  const parseTableRow = (value: string): TableCell[] => {
    const trimmed = value.trim().replace(/^\|/, '').replace(/\|$/, '')
    return trimmed.split('|').map((cell) => {
      const raw = cell.trim()
      return { raw, formatted: applyInlineFormatting(raw) }
    })
  }

  const parseAlignmentRow = (value: string): TableAlignment[] => {
    const trimmed = value.trim().replace(/^\|/, '').replace(/\|$/, '')
    if (!trimmed) return []
    return trimmed.split('|').map((cell) => {
      const segment = cell.trim()
      const startsWithColon = segment.startsWith(':')
      const endsWithColon = segment.endsWith(':')
      if (startsWithColon && endsWithColon) return 'center'
      if (endsWithColon) return 'right'
      return 'left'
    })
  }

  const emitTable = (rows: TableRow[], alignments: TableAlignment[]) => {
    if (rows.length === 0) return
    const columnCount = Math.max(...rows.map((row) => row.cells.length), alignments.length)
    if (columnCount === 0) return

    const normalizedAlignments = Array.from({ length: columnCount }, (_, idx) => alignments[idx] ?? 'left')
    const columnCharWidths = Array.from({ length: columnCount }, () => 1)
    rows.forEach((row) => {
      row.cells.forEach((cell, idx) => {
        columnCharWidths[idx] = Math.max(columnCharWidths[idx], cell.raw.length || 1)
      })
    })

    const targetTableWidth = 9000
    const minColumnWidth = 1400
    const totalChars = columnCharWidths.reduce((sum, value) => sum + value, 0) || columnCount
    const columnWidths = columnCharWidths.map((count) => {
      const proportionalWidth = Math.round((count / totalChars) * targetTableWidth)
      return Math.max(minColumnWidth, proportionalWidth)
    })
    const widthSum = columnWidths.reduce((sum, width) => sum + width, 0)
    if (widthSum < targetTableWidth && columnWidths.length > 0) {
      columnWidths[columnWidths.length - 1] += targetTableWidth - widthSum
    }

    let runningWidth = 0
    const boundString = columnWidths
      .map((width) => {
        runningWidth += width
        return `\\cellx${runningWidth}`
      })
      .join('')

    rows.forEach((row) => {
      rtfLines.push(`\\trowd\\trgaph108${boundString}`)
      const cellEntries: string[] = []
      for (let idx = 0; idx < columnCount; idx += 1) {
        const alignment = normalizedAlignments[idx]
        const alignmentTag = alignment === 'center' ? '\\qc' : alignment === 'right' ? '\\qr' : '\\ql'
        const cell = row.cells[idx]
        const formatted = cell ? (row.header ? `\\b ${cell.formatted}\\b0` : cell.formatted) : ''
        cellEntries.push(`\\pard\\intbl${alignmentTag}\\sa40\\sb40\\f0\\fs24 ${formatted}\\cell`)
      }
      rtfLines.push(`${cellEntries.join(' ')}\\row`)
    })
    rtfLines.push('\\pard')
  }

  let i = 0
  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (line && isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1].trim())) {
      const rows: TableRow[] = []
      const alignments = parseAlignmentRow(lines[i + 1])
      rows.push({ cells: parseTableRow(line), header: true })
      i += 2
      while (i < lines.length) {
        const candidate = lines[i].trim()
        if (!candidate || !candidate.includes('|')) break
        if (isSeparatorRow(candidate)) {
          i += 1
          continue
        }
        rows.push({ cells: parseTableRow(candidate), header: false })
        i += 1
      }
      emitTable(rows, alignments)
      if (i >= lines.length || (lines[i] && lines[i].trim().length > 0)) {
        rtfLines.push('\\par')
      }
      continue
    }

    if (!line) {
      rtfLines.push('\\par')
      i += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = applyInlineFormatting(headingMatch[2])
      const sizeMap: Record<number, number> = { 1: 48, 2: 40, 3: 32, 4: 28, 5: 24, 6: 22 }
      const size = sizeMap[level] ?? 24
      rtfLines.push(`\\pard\\sa200\\sb100\\f0\\fs${size}\\b ${text}\\b0\\fs24\\par`)
      i += 1
      continue
    }

    const bulletMatch = line.match(/^[-*+]\s+(.*)$/)
    if (bulletMatch) {
      const text = applyInlineFormatting(bulletMatch[1])
      rtfLines.push(`\\pard\\li720\\fi-360\\sa80\\sb40\\f0\\fs24\\bullet\\tab ${text}\\par`)
      i += 1
      continue
    }

    const orderedMatch = line.match(/^(\d+)[.)]\s+(.*)$/)
    if (orderedMatch) {
      const text = applyInlineFormatting(orderedMatch[2])
      rtfLines.push(`\\pard\\li720\\fi-360\\sa80\\sb40\\f0\\fs24 ${orderedMatch[1]}.\\tab ${text}\\par`)
      i += 1
      continue
    }

    const paragraph = applyInlineFormatting(line)
    rtfLines.push(`\\pard\\sa120\\sb0\\f0\\fs24 ${paragraph}\\par`)
    i += 1
  }

  return `${header}\n${rtfLines.join('\n')}\n}`
}

type DownloadFormat = 'txt' | 'md' | 'rtf' | 'pdf'

const normalizeProviderLabel = (value?: string | null) => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return DEFAULT_LLM_PROVIDER
  return trimmed
}

const buildRecentKey = (provider: string | null | undefined, prompt: string) =>
  `${normalizeProviderLabel(provider)}:::${prompt}`

const buildRecentId = (provider: string | null | undefined, prompt: string, timestamp: number | string) =>
  `recent-${buildRecentKey(provider, prompt)}:::${timestamp}`

const buildDownloadFilename = (message: Message, extension: DownloadFormat) => {
  const createdAt = new Date(message.createdAt || Date.now())
  const fallback = new Date()
  const safeDate = Number.isNaN(createdAt.getTime()) ? fallback : createdAt
  const iso = safeDate.toISOString().replace(/[:.]/g, '-')
  return `rendy-response-${iso}.${extension}`
}

const buildThreadDownloadFilename = (extension: DownloadFormat) => {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  return `rendy-thread-${iso}.${extension}`
}

const formatUserPromptForTranscript = (content: string) => {
  const normalized = content.trim()
  if (!normalized) return ''
  return normalized
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

const buildThreadMarkdown = (entries: Message[]) => {
  const available = entries.filter((message) => message.content && message.content.trim().length > 0)
  if (available.length === 0) {
    return '# Rendy Conversation\n\n_No messages available yet._'
  }

  const blocks = available.map((message) => {
    const speaker = message.role === 'assistant' ? 'Rendy' : 'You'
    const timestamp = formatDateTime(message.createdAt ?? Date.now())
    const body =
      message.role === 'assistant' ? message.content.trim() : formatUserPromptForTranscript(message.content)
    return `## ${speaker} · ${timestamp}\n\n${body}`.trim()
  })

  return ['# Rendy Conversation', ...blocks].join('\n\n')
}

type FlowiseResult = {
  answer: string
  citations?: Citation[]
  meta: ResponseMeta
  artifacts?: FlowiseArtifact[]
  agentReasoning?: AgentReasoningEntry[]
  aborted?: boolean
}

type FlowiseStreamChunk = {
  event?: string
  data?: unknown
}

type ResponseMeta = { chatId?: string; chatMessageId?: string; sessionId?: string }

const mergeMeta = (base: ResponseMeta, next: ResponseMeta): ResponseMeta => ({
  chatId: base.chatId ?? next.chatId,
  chatMessageId: base.chatMessageId ?? next.chatMessageId,
  sessionId: base.sessionId ?? next.sessionId,
})

const extractResponseMeta = (
  payload: FlowiseResponse | FlowiseResponse[] | undefined,
): ResponseMeta => {
  if (!payload) return {}

  if (Array.isArray(payload)) {
    return payload.reduce<ResponseMeta>((acc, entry) => {
      const meta = extractResponseMeta(entry)
      return mergeMeta(acc, meta)
    }, {})
  }

  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
  const meta: ResponseMeta = {
    chatId: typeof payload.chatId === 'string' ? payload.chatId : sessionId,
    chatMessageId: typeof payload.chatMessageId === 'string' ? payload.chatMessageId : undefined,
    sessionId,
  }

  if ((!meta.chatId || !meta.chatMessageId) && payload.data && typeof payload.data === 'object') {
    const nestedMeta = extractResponseMeta(payload.data as FlowiseResponse | FlowiseResponse[])
    return mergeMeta(meta, nestedMeta)
  }

  return meta
}

const maxAttachmentSizeBytes = 2 * 1024 * 1024
const maxAttachments = 4

const getAllDocuments = (payload?: FlowiseResponse | FlowiseResponse[]): FlowiseResponse['sourceDocuments'] => {
  if (!payload) return []

  const normalize = Array.isArray(payload) ? payload : [payload]

  return normalize.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const docs = Array.isArray(entry.sourceDocuments) ? entry.sourceDocuments : []
    const nested =
      entry.data && typeof entry.data === 'object'
        ? getAllDocuments(entry.data as FlowiseResponse | FlowiseResponse[])
        : []
    return [...docs, ...(Array.isArray(nested) ? nested : [])]
  })
}

const getAllArtifacts = (payload?: FlowiseResponse | FlowiseResponse[]): FlowiseArtifact[] => {
  if (!payload) return []

  const normalize = Array.isArray(payload) ? payload : [payload]

  return normalize.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : []
    const nested =
      entry.data && typeof entry.data === 'object'
        ? getAllArtifacts(entry.data as FlowiseResponse | FlowiseResponse[])
        : []
    return [...artifacts.map(applyArtifactDisplayHints), ...nested]
  })
}

const applyArtifactDisplayHints = (artifact: FlowiseArtifact): FlowiseArtifact => {
  if (!artifact) return artifact
  const name = typeof artifact.name === 'string' ? artifact.name.toLowerCase() : ''
  const type = typeof artifact.type === 'string' ? artifact.type.toLowerCase() : ''
  const mime = typeof artifact.mime === 'string' ? artifact.mime.toLowerCase() : ''

  if (name.includes('chart') || type.includes('chart') || mime.includes('image/') || isImageArtifactType(type)) {
    return {
      ...artifact,
      render: {
        ...(artifact.render ?? {}),
        widthPct: artifact.render?.widthPct ?? 90,
      },
    }
  }

  if (name.includes('table') && artifact.render?.hideTable === undefined) {
    return {
      ...artifact,
      render: {
        ...(artifact.render ?? {}),
        hideTable: true,
      },
    }
  }

  return artifact
}

const isChartArtifact = (artifact: FlowiseArtifact): boolean => {
  if (!artifact) return false
  if (typeof artifact.render?.widthPct === 'number') return true
  return isImageArtifactType((artifact.type ?? artifact.mime ?? '').toLowerCase())
}

const getAllAgentReasoning = (payload?: FlowiseResponse | FlowiseResponse[]): AgentReasoningEntry[] => {
  if (!payload) return []

  const normalize = Array.isArray(payload) ? payload : [payload]

  return normalize.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const reasoning = normalizeAgentReasoningPayload(entry.agentReasoning)
    const nested =
      entry.data && typeof entry.data === 'object'
        ? getAllAgentReasoning(entry.data as FlowiseResponse | FlowiseResponse[])
        : []
    return [...reasoning, ...nested]
  })
}

const normalizeAgentReasoningPayload = (payload: unknown): AgentReasoningEntry[] => {
  if (!payload) return []
  if (Array.isArray(payload)) return payload as AgentReasoningEntry[]
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload)
      return normalizeAgentReasoningPayload(parsed)
    } catch {
      return []
    }
  }
  if (typeof payload === 'object') return [payload as AgentReasoningEntry]
  return []
}

const buildCitations = (payload?: FlowiseResponse | FlowiseResponse[]): Citation[] => {
  const documents = getAllDocuments(payload) ?? []

  return documents.slice(0, 6).map((doc, index) => {
    const metadata = (doc?.metadata ?? {}) as Record<string, unknown>
    const title =
      (typeof metadata.title === 'string' && metadata.title) ||
      (typeof metadata.source === 'string' && metadata.source) ||
      `Source ${index + 1}`
    const url =
      (typeof metadata.url === 'string' && metadata.url) ||
      (typeof metadata.link === 'string' && metadata.link) ||
      undefined
    const meta =
      (typeof metadata.collection === 'string' && metadata.collection) ||
      (typeof metadata.namespace === 'string' && metadata.namespace) ||
      undefined

    return {
      id: `${title}-${index}`,
      title,
      url,
      meta,
    }
  })
}

const stripPreamble = (content: string) =>
  content.replace(
    /^Rendy is initiating AGENT MESH and QUERY Engine\. Stand up and stretch, this may take awhile\.\s*/i,
    '',
  )

const parseFlowiseAnswer = (payload: FlowiseResponse | FlowiseResponse[] | string | undefined): string => {
  if (!payload) return ''
  if (typeof payload === 'string') return stripPreamble(payload)
  if (Array.isArray(payload)) {
    const last = payload.at(-1)
    return last ? parseFlowiseAnswer(last) : ''
  }

  const direct =
    payload.text ||
    payload.answer ||
    payload.result ||
    payload.output ||
    payload.response ||
    payload.message ||
    (typeof payload.data === 'string' ? payload.data : '')

  if (direct) return stripPreamble(direct)

  if (payload.data && typeof payload.data === 'object') {
    return parseFlowiseAnswer(payload.data as FlowiseResponse | FlowiseResponse[])
  }

  return ''
}

function App() {
  const [messages, setMessages] = useState<Message[]>([initialAssistantMessage])
  const [composer, setComposer] = useState('')
  const [composerHistory, setComposerHistory] = useState<string[]>([])
  const [composerHistoryIndex, setComposerHistoryIndex] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const [isStopRequested, setIsStopRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { recents, savePrompt, deletePrompt: deleteRecentPrompt } = useRecentPrompts()
  const [recentPrompts, setRecentPrompts] = useState<RecentPrompt[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [openAIStatus, setOpenAIStatus] = useState<OpenAIStatusState>({
    indicator: 'unknown',
    description: 'Checking API…',
  })
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const { ensureSessionMeta, rememberSessionMeta, resetSessionMeta } = useChatSession(
    CHATFLOW_STORAGE_KEY,
    LEGACY_CHATFLOW_STORAGE_KEYS,
  )
  const streamAnchorRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const stopRequestedRef = useRef(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const historyMenuRef = useRef<HTMLDivElement | null>(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = window.localStorage.getItem(AUTOSCROLL_STORAGE_KEY)
      if (stored === 'false') return false
      if (stored === 'true') return true
      const legacyStored = window.localStorage.getItem(LEGACY_AUTOSCROLL_STORAGE_KEY)
      if (legacyStored === 'false') return false
      if (legacyStored === 'true') return true
    } catch {
      // ignore read failures
    }
    return false
  })

  const hasConversation = useMemo(
    () => messages.some((message) => message.role === 'user'),
    [messages],
  )

  useEffect(() => {
    if (!autoScrollEnabled) return
    if (!hasConversation) return
    streamAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, autoScrollEnabled, hasConversation])

  useEffect(() => {
    const handleClickAway = (event: globalThis.MouseEvent | TouchEvent) => {
      if (!historyMenuRef.current) return
      if (event.target instanceof Node && historyMenuRef.current.contains(event.target)) return
      setIsHistoryOpen(false)
    }
    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsHistoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('touchstart', handleClickAway)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('touchstart', handleClickAway)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(AUTOSCROLL_STORAGE_KEY, String(autoScrollEnabled))
    } catch {
      // ignore write errors
    }
  }, [autoScrollEnabled])

  useEffect(() => {
    const mapped = recents.map((record) => ({
      id: buildRecentId(record.provider ?? null, record.prompt, record.last_used_at),
      prompt: record.prompt,
      response: typeof record.response === 'string' ? record.response : undefined,
      timestamp: new Date(record.last_used_at).getTime(),
      provider: record.provider ?? null,
    }))
    const dedupedMap = mapped.reduce((map, item) => {
      const key = buildRecentKey(item.provider, item.prompt)
      const existing = map.get(key)
      if (!existing || item.timestamp > existing.timestamp) {
        map.set(key, item)
      }
      return map
    }, new Map<string, RecentPrompt>())
    const deduped = Array.from(dedupedMap.values()).sort((a, b) => b.timestamp - a.timestamp)
    setRecentPrompts(deduped.slice(0, 30))
  }, [recents])

  useEffect(() => {
    let isMounted = true

    const fetchOpenAIStatus = async () => {
      try {
        const response = await fetch(OPENAI_STATUS_SUMMARY_URL, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`OpenAI status returned ${response.status}`)
        }
        const payload = (await response.json()) as OpenAIStatusSummaryResponse
        if (!isMounted) return
        const components = selectOpenAIComponents(payload?.components)
        let indicator = deriveAggregateOpenAIIndicator(components)
        if (indicator === 'unknown') {
          indicator = deriveSummaryIndicator(payload?.status?.indicator)
        }
        setOpenAIStatus({
          indicator,
          description: buildOpenAIStatusDescription(indicator),
        })
      } catch (statusError) {
        console.error('Unable to retrieve OpenAI status.', statusError)
        if (!isMounted) return
        setOpenAIStatus((prev) =>
          prev.indicator === 'unknown'
            ? { indicator: 'yellow', description: buildOpenAIStatusDescription('yellow') }
            : prev,
        )
      }
    }

    fetchOpenAIStatus()
    const intervalId = window.setInterval(fetchOpenAIStatus, OPENAI_STATUS_POLL_INTERVAL)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  const sendPrompt = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? composer).trim()
    if (!prompt || isLoading) return

    stopRequestedRef.current = false
    setIsStopRequested(false)

    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    }

    const sessionMeta = ensureSessionMeta()

    const providerLabel = normalizeProviderLabel()
    setRecentPrompts((prev) => {
      const key = buildRecentKey(providerLabel, prompt)
      const deduped = prev.filter((entry) => buildRecentKey(entry.provider, entry.prompt) !== key)
      return [
        {
          id: buildRecentId(providerLabel, prompt, userMessage.createdAt),
          prompt,
          response: undefined,
          timestamp: userMessage.createdAt,
          provider: providerLabel,
        },
        ...deduped,
      ].slice(0, 30)
    })

    const placeholderId = createMessageId()
    const placeholder: Message = {
      id: placeholderId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      loading: true,
      chatId: sessionMeta.chatId,
      sessionId: sessionMeta.sessionId,
    }

    setComposer('')
    setError(null)
    setIsLoading(true)
    setMessages((prev) => [...prev, userMessage, placeholder])
    setComposerHistory((prev) => [...prev, prompt])
    setComposerHistoryIndex(null)

    const mutatePlaceholder = (update: Partial<Message> | ((message: Message) => Message)) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== placeholderId) return message
          return typeof update === 'function' ? update(message) : { ...message, ...update }
        }),
      )
    }

    if (!FLOWISE_DIRECT_API_URL && !CHATFLOW_ID) {
      setError(FLOWISE_CONFIG_ERROR)
      mutatePlaceholder({
        loading: false,
        content: FLOWISE_CONFIG_ERROR,
        createdAt: Date.now(),
      })
      setIsLoading(false)
      return
    }

    const finalizeMessage = (
      content: string,
      citations?: Citation[],
      meta: ResponseMeta = {},
      artifacts?: FlowiseArtifact[],
      agentReasoning?: AgentReasoningEntry[],
    ) => {
      const normalized = content && content.trim().length > 0 ? content : FLOWISE_NO_ANSWER_FALLBACK
      rememberSessionMeta({ chatId: meta.chatId, sessionId: meta.sessionId })
      mutatePlaceholder((message) => ({
        ...message,
        loading: false,
        content: normalized,
        citations: citations ?? message.citations,
        artifacts: artifacts ?? message.artifacts,
        agentReasoning: agentReasoning ?? message.agentReasoning,
        createdAt: Date.now(),
        chatId: meta.chatId ?? message.chatId,
        chatMessageId: meta.chatMessageId ?? message.chatMessageId,
        sessionId: meta.sessionId ?? message.sessionId,
        feedback: null,
        feedbackSubmitting: false,
      }))
      return normalized
    }

    if (isRendyInsult(prompt)) {
      const playfulResponse =
        "Hey now, be nice to Rendy. Here's a Not Hotdog instead.\n\n![Not Hotdog](/not-hotdog.png)"
      const meta: ResponseMeta = { chatId: sessionMeta.chatId, sessionId: sessionMeta.sessionId }
      const finalAnswer = finalizeMessage(playfulResponse, undefined, meta)
      setRecentPrompts((prev) =>
        prev.map((entry) =>
          buildRecentKey(entry.provider, entry.prompt) === buildRecentKey(providerLabel, prompt)
            ? { ...entry, response: finalAnswer }
            : entry,
        ),
      )
      void savePrompt(prompt, finalAnswer, providerLabel)
      setAttachments([])
      setIsLoading(false)
      return
    }

    const attachmentContext =
      attachments.length > 0
        ? `\n\nAttachments:\n${attachments
            .map(
              (file, index) =>
                `${index + 1}. ${file.name} (${file.type || 'unknown'}, ${Math.round(
                  file.size / 1024,
                )}KB)\nData URL (base64): ${file.dataUrl}`,
            )
            .join('\n\n')}`
        : ''

    const questionWithAttachments = `${prompt}${attachmentContext}`

    const payload: Record<string, unknown> = {
      question: questionWithAttachments,
      attachments: attachments.map(({ id, name, size, type, dataUrl }) => ({
        id,
        name,
        size,
        type,
        dataUrl,
      })),
    }

    payload.chatId = sessionMeta.chatId
    payload.sessionId = sessionMeta.sessionId
    if (import.meta.env.DEV) {
      console.log('Sending chatId', sessionMeta.chatId, 'sessionId', sessionMeta.sessionId)
    }

    const streamFlowiseResponse = async (): Promise<FlowiseResult> => {
      const streamingPayload = { ...payload, streaming: true }
      let rawAnswer = ''
      let streamingCitations: Citation[] | undefined
      let meta: ResponseMeta = {}
      let streamingArtifacts: FlowiseArtifact[] | undefined
      let streamingAgentReasoning: AgentReasoningEntry[] | undefined
      const controller = new AbortController()
      abortControllerRef.current = controller
      setIsStreamingResponse(true)

      try {
        await fetchEventSource(RENDY_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(streamingPayload),
          openWhenHidden: true,
          signal: controller.signal,
          async onopen(response) {
            const contentType = response.headers.get('content-type') ?? ''
            if (response.ok && contentType.startsWith(EventStreamContentType)) {
              return
            }
            if (response.ok) {
              throw new Error(STREAMING_NOT_SUPPORTED_ERROR)
            }
            const errorText = await response.text()
            throw new Error(errorText || `Flowise returned ${response.status}`)
          },
          onmessage(ev) {
            if (!ev.data || ev.data === '[DONE]') return
            let parsed: FlowiseStreamChunk
            try {
              const candidate = JSON.parse(ev.data)
              if (!isRecord(candidate)) {
                return
              }
              parsed = candidate as FlowiseStreamChunk
            } catch {
              return
            }

            switch (parsed.event) {
              case 'start':
                mutatePlaceholder({ loading: true })
                break
              case 'token':
                if (typeof parsed.data === 'string' && parsed.data.length > 0) {
                  rawAnswer += parsed.data
                  const visible = stripPreamble(rawAnswer)
                  mutatePlaceholder({ content: visible, loading: false })
                }
                break
              case 'sourceDocuments':
                if (Array.isArray(parsed.data)) {
                  const docsResponse = { sourceDocuments: parsed.data } as FlowiseResponse
                  streamingCitations = buildCitations(docsResponse)
                  mutatePlaceholder({ citations: streamingCitations })
                }
                break
              case 'artifacts':
                if (Array.isArray(parsed.data)) {
                  streamingArtifacts = parsed.data as FlowiseArtifact[]
                  mutatePlaceholder({ artifacts: streamingArtifacts })
                }
                break
              case 'agentReasoning':
                streamingAgentReasoning = normalizeAgentReasoningPayload(parsed.data)
                if (streamingAgentReasoning.length > 0) {
                  mutatePlaceholder({ agentReasoning: streamingAgentReasoning })
                }
                break
              case 'metadata': {
                const metadataPayload = isRecord(parsed.data)
                  ? (parsed.data as Partial<ResponseMeta>)
                  : undefined
                const chunk: ResponseMeta = {
                  chatId: typeof metadataPayload?.chatId === 'string' ? metadataPayload.chatId : undefined,
                  chatMessageId:
                    typeof metadataPayload?.chatMessageId === 'string'
                      ? metadataPayload.chatMessageId
                      : undefined,
                  sessionId: typeof metadataPayload?.sessionId === 'string' ? metadataPayload.sessionId : undefined,
                }
                meta = mergeMeta(meta, chunk)
                mutatePlaceholder((message) => ({
                  ...message,
                  chatId: meta.chatId ?? message.chatId,
                  chatMessageId: meta.chatMessageId ?? message.chatMessageId,
                  sessionId: meta.sessionId ?? message.sessionId,
                }))
                break
              }
              case 'error':
              case 'abort': {
                const message =
                  typeof parsed.data === 'string' && parsed.data.trim().length > 0
                    ? parsed.data
                    : 'Flowise streaming error.'
                throw new Error(message)
              }
              case 'end':
                break
              default:
                break
            }
          },
          onclose() {
            return
          },
          onerror(err) {
            throw err
          },
        })
      } catch (err) {
        if (
          stopRequestedRef.current &&
          err instanceof DOMException &&
          err.name === 'AbortError'
        ) {
          const partialAnswer = stripPreamble(rawAnswer)
          return {
            answer: partialAnswer,
            citations: streamingCitations,
            meta,
            artifacts: streamingArtifacts,
            agentReasoning: streamingAgentReasoning,
            aborted: true,
          }
        }
        throw err
      } finally {
        setIsStreamingResponse(false)
        abortControllerRef.current = null
      }

      const cleanedAnswer = stripPreamble(rawAnswer)
      return {
        answer: cleanedAnswer,
        citations: streamingCitations,
        meta,
        artifacts: streamingArtifacts,
        agentReasoning: streamingAgentReasoning,
      }
    }

    const fetchFlowiseResponse = async (): Promise<FlowiseResult> => {
      const response = await fetch(RENDY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Flowise returned ${response.status}`)
      }

      const data = (await response.json()) as FlowiseResponse | FlowiseResponse[]
      const answer = parseFlowiseAnswer(data)
      const citations = buildCitations(data)
      const artifacts = getAllArtifacts(data)
      const agentReasoning = getAllAgentReasoning(data)
      const meta = extractResponseMeta(data)
      return { answer, citations, meta, artifacts, agentReasoning }
    }

    try {
      let result: FlowiseResult | null = null

      if (FLOWISE_STREAMING_ENABLED) {
        try {
          result = await streamFlowiseResponse()
        } catch (streamError) {
          if (streamError instanceof Error && streamError.message === STREAMING_NOT_SUPPORTED_ERROR) {
            if (import.meta.env.DEV) {
              console.warn('Flowise streaming unavailable, falling back to JSON mode.')
            }
          } else {
            throw streamError
          }
        }
      }

      if (!result) {
        result = await fetchFlowiseResponse()
      }

      const finalAnswer = finalizeMessage(
        result.answer,
        result.citations,
        result.meta,
        result.artifacts,
        result.agentReasoning,
      )

      if (!result.aborted) {
        setRecentPrompts((prev) =>
          prev.map((entry) =>
            buildRecentKey(entry.provider, entry.prompt) === buildRecentKey(providerLabel, prompt)
              ? { ...entry, response: finalAnswer }
              : entry,
          ),
        )
        void savePrompt(prompt, finalAnswer, providerLabel)
      }
    } catch (err) {
      console.error(err)
      const fallback = FLOWISE_ERROR_FALLBACK
      setError(err instanceof Error ? err.message : 'Unknown error')
      mutatePlaceholder((message) => ({
        ...message,
        loading: false,
        content: fallback,
        citations: undefined,
        createdAt: Date.now(),
        feedback: null,
        feedbackSubmitting: false,
      }))
      setRecentPrompts((prev) =>
        prev.map((entry) =>
          buildRecentKey(entry.provider, entry.prompt) === buildRecentKey(providerLabel, prompt)
            ? { ...entry, response: fallback }
            : entry,
        ),
      )
      void savePrompt(prompt, fallback, providerLabel)
    } finally {
      setAttachments([])
      setIsLoading(false)
      setIsStreamingResponse(false)
      abortControllerRef.current = null
      stopRequestedRef.current = false
      setIsStopRequested(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const modifiersActive = event.altKey || event.metaKey || event.ctrlKey
    const textarea = event.currentTarget
    const caretAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0
    const caretAtEnd =
      textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length
    const historyIndex = composerHistoryIndex

    if (event.key === 'ArrowUp' && !event.shiftKey && !modifiersActive) {
      if (!caretAtStart || composerHistory.length === 0) return
      event.preventDefault()
      const nextIndex = historyIndex === null ? composerHistory.length - 1 : Math.max(historyIndex - 1, 0)
      if (nextIndex >= 0 && composerHistory[nextIndex] !== undefined) {
        setComposer(composerHistory[nextIndex] ?? '')
        setComposerHistoryIndex(nextIndex)
      }
      return
    }

    if (event.key === 'ArrowDown' && !event.shiftKey && !modifiersActive) {
      if (!caretAtEnd || composerHistory.length === 0) return
      event.preventDefault()
      if (historyIndex === null) {
        setComposer('')
        return
      }
      const nextIndex = historyIndex + 1
      if (nextIndex < composerHistory.length) {
        setComposer(composerHistory[nextIndex] ?? '')
        setComposerHistoryIndex(nextIndex)
      } else {
        setComposer('')
        setComposerHistoryIndex(null)
      }
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendPrompt()
    }
  }

  const handleSuggestion = (prompt: string) => {
    void sendPrompt(prompt)
  }

  const handleRecentClick = (thread: RecentPrompt) => {
    const trimmedPrompt = thread.prompt.trim()
    const providerLabel = normalizeProviderLabel(thread.provider)
    setComposer(trimmedPrompt)
    composerRef.current?.focus()

    const timestamp = thread.timestamp || Date.now()
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: `${trimmedPrompt}\n\n(LLM: ${providerLabel})`,
      createdAt: timestamp,
    }

    const assistantMessage: Message | null =
      thread.response && thread.response.trim().length > 0
        ? {
            id: createMessageId(),
            role: 'assistant',
            content: thread.response,
            createdAt: timestamp + 1,
          }
        : null

    setMessages((prev): Message[] => [...prev, userMessage, ...(assistantMessage ? [assistantMessage] : [])])
    setError(null)
  }

  const removeRecentEntry = (id: string) => {
    const target = recentPrompts.find((entry) => entry.id === id)
    setRecentPrompts((prev) => prev.filter((entry) => entry.id !== id))
    if (target) {
      void deleteRecentPrompt(target.prompt, target.provider ?? null)
    }
  }

  const handleRemoveRecent = (event: ReactMouseEvent | KeyboardEvent, id: string) => {
    event.stopPropagation()
    if ('key' in event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
    }
    removeRecentEntry(id)
  }

  const handleAttachmentButton = () => {
    fileInputRef.current?.click()
  }

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const existing = attachments.length
    if (existing >= maxAttachments) {
      setError(`Maximum of ${maxAttachments} attachments reached.`)
      event.target.value = ''
      return
    }

    const allowedSlots = maxAttachments - existing
    const selection = Array.from(files).slice(0, allowedSlots)

    selection.forEach((file) => {
      if (file.size > maxAttachmentSizeBytes) {
        setError(`"${file.name}" exceeds ${(maxAttachmentSizeBytes / (1024 * 1024)).toFixed(1)}MB limit.`)
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        setAttachments((prev) => [
          ...prev,
          {
            id: createMessageId(),
            name: file.name,
            size: file.size,
            type: file.type,
            dataUrl,
          },
        ])
      }
      reader.onerror = () => {
        setError(`Failed to read "${file.name}".`)
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const handleCopy = async (message: Message) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message.content)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = message.content
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (clipboardError) {
      console.error(clipboardError)
      setError('Unable to copy response to clipboard.')
    }
  }

  const downloadMarkdownContent = async (markdown: string, format: DownloadFormat, filename: string) => {
    if (typeof document === 'undefined') return

    if (format === 'pdf') {
      const doc = new jsPDF({ unit: 'pt', format: 'letter' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 36
      const container = document.createElement('div')
      container.style.position = 'fixed'
      container.style.left = '-9999px'
      container.style.top = '0'
      container.style.width = `${pageWidth - margin * 2}px`
      const pdfStyles = `
        <style>
          .pdf-root { font-family: 'Inter', Arial, sans-serif; color: #f7f8fb; background: #050b14; padding: 32px; line-height: 1.7; }
          .pdf-root h1, .pdf-root h2, .pdf-root h3, .pdf-root h4 { color: #ffffff; margin: 24px 0 12px; }
          .pdf-root p { margin: 0 0 12px; }
          .pdf-root ul, .pdf-root ol { margin: 0 0 12px 24px; }
          .pdf-root li { margin-bottom: 6px; }
          .pdf-root table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11pt; }
          .pdf-root th, .pdf-root td { border: 1px solid rgba(247,248,251,0.2); padding: 8px 10px; }
          .pdf-root pre { background: #0c1224; border-radius: 12px; padding: 16px; color: #f7f8fb; overflow: auto; }
          .pdf-root code { background: #0c1224; color: #f7f8fb; padding: 2px 6px; border-radius: 6px; font-family: 'Courier New', monospace; }
          .pdf-root blockquote { border-left: 4px solid #57c6ff; padding-left: 12px; color: rgba(247,248,251,0.75); margin: 16px 0; }
          .pdf-root a { color: #57c6ff; text-decoration: none; }
        </style>
      `
      container.innerHTML = `${pdfStyles}<div class="pdf-root">${renderToStaticMarkup(
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => (
              <a {...props} rel="noreferrer" target="_blank" />
            ),
            code: (nodeProps) => {
              const { inline, className, children } = nodeProps as {
                inline?: boolean
                className?: string
                children?: ReactNode
              }
              return inline ? (
                <code className={className}>{children}</code>
              ) : (
                <pre className={className}>
                  <code>{children}</code>
                </pre>
              )
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      )}</div>`

      document.body.appendChild(container)
      const canvas = await html2canvas(container, {
        scale: 2,
        width: container.offsetWidth,
        height: container.offsetHeight,
        backgroundColor: '#050b14',
      })
      document.body.removeChild(container)

      const imgData = canvas.toDataURL('image/png')
      const imgWidth = pageWidth - margin * 2
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const usableHeight = pageHeight - margin * 2

      let heightLeft = imgHeight
      const position = margin

      doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST')
      heightLeft -= usableHeight

      while (heightLeft > 0) {
        doc.addPage()
        doc.addImage(imgData, 'PNG', margin, heightLeft - imgHeight + margin, imgWidth, imgHeight, undefined, 'FAST')
        heightLeft -= usableHeight
      }

      doc.save(filename)
      return
    }

    const mimeType =
      format === 'md'
        ? 'text/markdown;charset=utf-8'
        : format === 'rtf'
          ? 'application/rtf'
          : 'text/plain;charset=utf-8'
    const content =
      format === 'md'
        ? markdown
        : format === 'rtf'
          ? convertMarkdownToRichText(markdown)
          : convertMarkdownToPlainText(markdown)

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDownload = async (message: Message, format: DownloadFormat) => {
    try {
      const filename = buildDownloadFilename(message, format)
      await downloadMarkdownContent(message.content, format, filename)
    } catch (downloadError) {
      console.error(downloadError)
      setError('Unable to download this response right now.')
    }
  }

  const handleThreadDownload = async (format: DownloadFormat) => {
    const printableMessages = messages.filter((entry) => entry.content && entry.content.trim().length > 0)
    if (printableMessages.length === 0) {
      setError('There is no chat history to download yet.')
      return
    }

    try {
      const markdown = buildThreadMarkdown(printableMessages)
      const filename = buildThreadDownloadFilename(format)
      await downloadMarkdownContent(markdown, format, filename)
    } catch (downloadError) {
      console.error(downloadError)
      setError('Unable to download the full chat right now.')
    }
  }

  const handleStopStreaming = () => {
    if (!abortControllerRef.current) return
    stopRequestedRef.current = true
    setIsStopRequested(true)
    abortControllerRef.current.abort()
  }

  const handleFeedback = async (message: Message, rating: 'THUMBS_UP' | 'THUMBS_DOWN') => {
    const activeChatMeta = ensureSessionMeta()
    const activeChatId = message.chatId ?? activeChatMeta.chatId
    if (!activeChatId || !message.chatMessageId || !CHATFLOW_ID) {
      setError('Feedback metadata is unavailable for this response.')
      return
    }

    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === message.id ? { ...entry, feedbackSubmitting: true, feedback: rating } : entry,
      ),
    )

    try {
      const response = await fetch(FEEDBACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        mode: 'cors',
        body: JSON.stringify({
          chatflowid: CHATFLOW_ID,
          chatId: activeChatId,
          messageId: message.chatMessageId,
          rating,
        }),
      })

      if (!response.ok) {
        throw new Error(`Flowise feedback endpoint returned ${response.status}`)
      }
    } catch (feedbackError) {
      console.error(feedbackError)
      setError(feedbackError instanceof Error ? feedbackError.message : 'Unable to submit feedback.')
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === message.id ? { ...entry, feedbackSubmitting: false, feedback: null } : entry,
        ),
      )
      return
    }

    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === message.id ? { ...entry, feedbackSubmitting: false, feedback: rating } : entry,
      ),
    )
  }

  const resetThread = () => {
    abortControllerRef.current?.abort()
    stopRequestedRef.current = false
    setIsStreamingResponse(false)
    setIsLoading(false)
    setIsStopRequested(false)
    setMessages([initialAssistantMessage])
    setComposer('')
    setComposerHistory([])
    setComposerHistoryIndex(null)
    setAttachments([])
    setError(null)
    resetSessionMeta()
  }

  const toggleHistoryMenu = () => {
    setIsHistoryOpen((prev) => !prev)
  }

  const handleHistorySelect = (thread: RecentPrompt) => {
    setIsHistoryOpen(false)
    handleRecentClick(thread)
  }

  const handleToggleAutoScroll = () => {
    setAutoScrollEnabled((prev) => {
      const next = !prev
      if (!prev && streamAnchorRef.current) {
        window.requestAnimationFrame(() => {
          streamAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })
        })
      }
      return next
    })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar left">
        <div className="sidebar-header">
          <div className="workspace-brand">
            <img src="/rendy-bot.png" alt="Rendy bot" className="logo-mark" />
            <div>
              <p className="eyebrow">Workspace</p>
              <h1>Rendy</h1>
            </div>
          </div>
          <span className="status-dot" />
        </div>

        <button type="button" className="new-thread" onClick={resetThread}>
          + New thread
        </button>

        <div className="sidebar-section">
          <p className="section-label">Recents</p>
          <div className="thread-list">
            {recentPrompts.length === 0 ? (
              <p className="thread-empty">No history yet.</p>
            ) : (
              recentPrompts.map((thread) => (
                <button
                  type="button"
                  key={thread.id}
                  className="thread-card"
                  onClick={() => handleRecentClick(thread)}
                >
                  <span
                    className="thread-remove"
                    role="button"
                    tabIndex={0}
                    aria-label="Delete this history entry"
                    onClick={(event) => handleRemoveRecent(event, thread.id)}
                    onKeyDown={(event) => handleRemoveRecent(event, thread.id)}
                  >
                    ×
                  </span>
                  <small>{formatRecentLabel(thread.timestamp)}</small>
                  <span>{truncatePrompt(thread.prompt)}</span>
                  {thread.response && (
                    <span className="thread-response">{truncatePrompt(thread.response, 80)}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <p className="section-label">Shortcuts</p>
          <div className="tag-cloud">
            {navShortcuts.map((shortcut) => (
              <a
                key={shortcut.label}
                className="tag"
                href={shortcut.url}
                target="_blank"
                rel="noreferrer"
              >
                {shortcut.label}
              </a>
            ))}
          </div>
        </div>

      </aside>

      <main className="main-panel">
        <header className="main-header">
          <div className="main-title">
            <img src="/rendy-render-logo.svg" alt="Render logo" className="brand-logo" />
            <h2>Render - Assistant</h2>
          </div>
          <div className="main-header-actions">
            <div className="status-chip" data-status={openAIStatus.indicator}>
              <span className="openai-status-dot" data-status={openAIStatus.indicator} aria-hidden="true" />
              Render API · {openAIStatus.description}
            </div>
            <div className="history-menu" ref={historyMenuRef}>
              <button
                type="button"
                className="history-toggle"
                onClick={toggleHistoryMenu}
                aria-expanded={isHistoryOpen}
                aria-haspopup="true"
              >
                <span>Recent chats</span>
                <span className="history-count">{recentPrompts.length}</span>
                <span className="history-caret" data-open={isHistoryOpen ? 'true' : undefined} aria-hidden="true" />
              </button>
              <div className="history-menu-panel" data-open={isHistoryOpen ? 'true' : undefined} role="menu">
                {recentPrompts.length === 0 ? (
                  <p className="history-empty">No history yet.</p>
                ) : (
                  recentPrompts.slice(0, 6).map((thread) => (
                    <button
                      type="button"
                      key={thread.id}
                      className="history-item"
                      onClick={() => handleHistorySelect(thread)}
                      role="menuitem"
                    >
                      <span className="history-title">{truncatePrompt(thread.prompt, 70)}</span>
                      {thread.response && (
                        <small className="history-subtitle">{truncatePrompt(thread.response, 80)}</small>
                      )}
                      <small className="history-meta">{formatRecentLabel(thread.timestamp)}</small>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </header>

        {!hasConversation && (
          <section className="suggestion-grid">
            {suggestionCards.map((card) => (
              <button
                type="button"
                key={card.title}
                className="suggestion-card"
                onClick={() => handleSuggestion(card.prompt)}
              >
                <p className="eyebrow">{card.title}</p>
                <p>{card.prompt}</p>
                <span>Ask Rendy ↗</span>
              </button>
            ))}
          </section>
        )}

        <section className="conversation-panel">
          {messages.map((message) => {
            const isInitialGreeting = message.id === initialAssistantMessage.id
            return (
              <article key={message.id} className={`message-card ${message.role}`}>
                <div className="message-meta">
                  <span>{message.role === 'assistant' ? 'Rendy' : 'You'}</span>
                  <small>{formatTimestamp(message.createdAt)}</small>
                </div>

                {message.loading ? (
                  <div className="message-loader">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <div className="message-body markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: (props) => (
                          <a {...props} rel="noreferrer" target="_blank" />
                        ),
                        code: MarkdownCodeBlock,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}

                {message.artifacts && message.artifacts.length > 0 && (
                  <ArtifactGallery artifacts={message.artifacts} message={message} />
                )}

                {message.agentReasoning && message.agentReasoning.length > 0 && (
                  <AgentReasoningBoard agentReasoning={message.agentReasoning} message={message} />
                )}

                {message.citations && message.citations.length > 0 && (
                  <div className="citation-row">
                    {message.citations.map((citation) => (
                      <a
                        key={citation.id}
                        href={citation.url ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="citation-chip"
                      >
                        <span>{citation.title}</span>
                        {citation.meta && <small>{citation.meta}</small>}
                      </a>
                    ))}
                  </div>
                )}
                <div className="message-actions">
                  {!isInitialGreeting && (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void handleCopy(message)}
                        aria-label="Copy response"
                      >
                        <ClipboardIcon color={copiedMessageId === message.id ? '#C6FF7F' : undefined} />
                      </button>
                      {copiedMessageId === message.id && <span className="action-hint">Copied</span>}
                    </>
                  )}
                  {message.role === 'assistant' && !message.loading && !isInitialGreeting && (
                    <div className="download-menu">
                      <button
                        type="button"
                        className="icon-button download-trigger"
                        aria-label="Download response"
                        aria-haspopup="true"
                      >
                        <DownloadIcon />
                      </button>
                      <div className="download-options" role="menu">
                        <button type="button" onClick={() => void handleDownload(message, 'txt')} role="menuitem">
                          Text (.txt)
                        </button>
                        <button type="button" onClick={() => void handleDownload(message, 'md')} role="menuitem">
                          Markdown (.md)
                        </button>
                        <button type="button" onClick={() => void handleDownload(message, 'rtf')} role="menuitem">
                          Rich Text (.rtf)
                        </button>
                        <button type="button" onClick={() => void handleDownload(message, 'pdf')} role="menuitem">
                          PDF (.pdf)
                        </button>
                      </div>
                    </div>
                  )}

                  {message.role === 'assistant' &&
                    !message.loading &&
                    !isInitialGreeting &&
                    message.chatId &&
                    message.chatMessageId && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          data-active={message.feedback === 'THUMBS_UP'}
                          disabled={message.feedbackSubmitting}
                          aria-label="Thumbs up"
                          onClick={() => void handleFeedback(message, 'THUMBS_UP')}
                          data-variant="positive"
                        >
                          <ThumbsUpIcon color={message.feedback === 'THUMBS_UP' ? '#C6FF7F' : undefined} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          data-active={message.feedback === 'THUMBS_DOWN'}
                          disabled={message.feedbackSubmitting}
                          aria-label="Thumbs down"
                          onClick={() => void handleFeedback(message, 'THUMBS_DOWN')}
                          data-variant="negative"
                        >
                          <ThumbsDownIcon color={message.feedback === 'THUMBS_DOWN' ? '#FF7B7B' : undefined} />
                        </button>
                      </>
                    )}
                </div>
              </article>
            )
          })}
          <div ref={streamAnchorRef} />
        </section>

        <section className="composer-panel">
          <div className="composer-shell">
            <textarea
              ref={composerRef}
              value={composer}
              placeholder="Ask Rendy anything…"
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={3}
            />
            <div className="attachment-toolbar">
              <button
                type="button"
                className="attach-button"
                onClick={handleAttachmentButton}
                disabled={isLoading}
                aria-label="Attach file"
              >
                <PaperclipIcon />
                <span className="attach-label">Attach file</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleAttachmentChange}
                accept=".pdf,.txt,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*"
              />
              <span className="attachment-note">
                Up to {maxAttachments} files · {(maxAttachmentSizeBytes / (1024 * 1024)).toFixed(1)}MB each
              </span>
            </div>
            {attachments.length > 0 && (
              <div className="attachment-list">
                {attachments.map((file) => (
                  <span key={file.id} className="attachment-chip">
                    <span>{file.name}</span>
                    <button type="button" onClick={() => removeAttachment(file.id)} aria-label="Remove attachment">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-actions">
              <div className="composer-meta">
                <div className="composer-hint">
                  Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for newline
                </div>
                <label
                  className="autoscroll-toggle"
                  data-enabled={autoScrollEnabled ? 'true' : 'false'}
                  title={autoScrollEnabled ? 'Auto-scroll is on' : 'Auto-scroll is off'}
                >
                  <input
                    type="checkbox"
                    checked={autoScrollEnabled}
                    onChange={handleToggleAutoScroll}
                    aria-label="Toggle automatic scrolling to the latest message"
                  />
                  <span className="autoscroll-visual" aria-hidden="true">
                    <span className="autoscroll-thumb" />
                  </span>
                  <span className="autoscroll-label">Auto-scroll</span>
                </label>
              </div>
              <div className="composer-buttons">
                <button
                  type="button"
                  className="mobile-new-thread"
                  onClick={resetThread}
                  aria-label="Start a new thread"
                  title="Start a new thread"
                >
                  +
                </button>
                <div className="download-menu thread-download-menu">
                  <button
                    type="button"
                    className="icon-button download-trigger"
                    aria-label="Download full chat thread"
                  >
                    <DownloadIcon />
                  </button>
                  <div className="download-options" role="menu">
                    <button type="button" onClick={() => void handleThreadDownload('txt')} role="menuitem">
                      Full chat (.txt)
                    </button>
                    <button type="button" onClick={() => void handleThreadDownload('md')} role="menuitem">
                      Full chat (.md)
                    </button>
                    <button type="button" onClick={() => void handleThreadDownload('rtf')} role="menuitem">
                      Full chat (.rtf)
                    </button>
                    <button type="button" onClick={() => void handleThreadDownload('pdf')} role="menuitem">
                      Full chat (.pdf)
                    </button>
                  </div>
                </div>
                {isStreamingResponse && (
                  <button
                    type="button"
                    className="stop-button"
                    onClick={handleStopStreaming}
                    disabled={isStopRequested}
                  >
                    {isStopRequested ? 'Stopping…' : 'Stop'}
                  </button>
                )}
                <button
                  type="button"
                  className="ask-button"
                  onClick={() => void sendPrompt()}
                  disabled={!composer.trim() || isLoading}
                >
                  {isLoading ? 'Thinking…' : 'Ask Rendy'}
                </button>
              </div>
            </div>
          </div>
          {error && <p className="error-banner">{error}</p>}
        </section>
      </main>
    </div>
  )
}

export default App

type MarkdownCodeBlockProps = HTMLAttributes<HTMLElement> & {
  inline?: boolean
  className?: string
  children?: ReactNode
  node?: unknown
}

const MarkdownCodeBlock = ({ inline, className, children, node, ...rest }: MarkdownCodeBlockProps) => {
  void node
  const [copied, setCopied] = useState(false)
  const codeText = extractTextFromNode(children).replace(/\n$/, '')
  const language = (className?.replace('language-', '') || 'text').toLowerCase()
  const languageLabel = language ? language.toUpperCase() : 'TEXT'
  const safeExtension = language.replace(/[^a-z0-9+.-]/gi, '') || 'txt'
  const isInline = Boolean(inline)
  const trimmed = codeText.trim()
  const isFakeTextBlock = !isInline && languageLabel === 'TEXT' && trimmed.length > 0 && !trimmed.includes('\n')

  if (isInline) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  }

  if (isFakeTextBlock) {
    return (
      <code className={className} {...rest}>
        {trimmed}
      </code>
    )
  }

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeText)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = codeText
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Unable to copy code block.', error)
    }
  }

  const handleDownload = () => {
    try {
      const filename = `rendy-code-${Date.now()}.${safeExtension}`
      const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Unable to download code block.', error)
    }
  }

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span className="code-language">{languageLabel}</span>
        <div className="code-actions">
          <button
            type="button"
            className="code-action-button"
            aria-label="Copy code block"
            onClick={() => void handleCopy()}
            data-copied={copied ? 'true' : undefined}
          >
            <ClipboardIcon color={copied ? '#C6FF7F' : undefined} />
          </button>
          <button type="button" className="code-action-button" aria-label="Download code block" onClick={handleDownload}>
            <DownloadIcon />
          </button>
        </div>
      </div>
      <pre>
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  )
}

type ArtifactGalleryProps = {
  artifacts: FlowiseArtifact[]
  message: Message
}

const ArtifactGallery = ({ artifacts, message }: ArtifactGalleryProps) => {
  if (!artifacts || artifacts.length === 0) return null

  const chartArtifacts = artifacts.filter((artifact) => isChartArtifact(artifact))
  const fallbackArtifacts = artifacts.filter((artifact) => artifact.render?.hideTable !== true)
  const visibleArtifacts = (chartArtifacts.length > 0 ? chartArtifacts : fallbackArtifacts).slice(0, 3)

  if (visibleArtifacts.length === 0) return null

  return (
    <div className="artifact-gallery">
      {visibleArtifacts.map((artifact, index) => {
        const content = renderArtifactContent(artifact, message)
        if (!content) return null
        const key = `${artifact.name ?? artifact.type ?? 'artifact'}-${index}`
        const normalizedType = (artifact.type ?? artifact.mime ?? '').toLowerCase()
        const isImageCard = isImageArtifactType(normalizedType)
        return (
          <div
            key={key}
            className="artifact-card"
            data-wide={artifact.render?.widthPct ? 'true' : undefined}
            data-image={isImageCard ? 'true' : undefined}
          >
            {content}
            {artifact.name && <span className="artifact-label">{artifact.name}</span>}
          </div>
        )
      })}
    </div>
  )
}

type AgentReasoningBoardProps = {
  agentReasoning: AgentReasoningEntry[]
  message: Message
}

const AgentReasoningBoard = ({ agentReasoning, message }: AgentReasoningBoardProps) => {
  if (!agentReasoning || agentReasoning.length === 0) return null

  return (
    <div className="agent-reasoning">
      {agentReasoning.map((entry, idx) => {
        const text = buildAgentReasoningText(entry)
        return (
          <div key={`${entry.agentName ?? 'agent'}-${idx}`} className="agent-reasoning-entry">
            <div className="agent-reasoning-header">
              <strong>{entry.agentName ?? `Agent ${idx + 1}`}</strong>
              {entry.nextAgent && <small>Next: {entry.nextAgent}</small>}
            </div>
            {entry.artifacts && entry.artifacts.length > 0 && (
              <div className="agent-reasoning-artifacts">
                {entry.artifacts.map((artifact, artifactIdx) => {
                  const content = renderArtifactContent(artifact, message)
                  if (!content) return null
                  return (
                    <div key={`${artifact.name ?? artifact.type ?? 'artifact'}-${artifactIdx}`} className="agent-artifact-card">
                      {content}
                    </div>
                  )
                })}
              </div>
            )}
            {text && (
              <div className="agent-reasoning-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: (props) => <a {...props} rel="noreferrer" target="_blank" /> }}
                >
                  {text}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const buildAgentReasoningText = (entry: AgentReasoningEntry): string => {
  if (entry.instructions && entry.instructions.trim().length > 0) return entry.instructions
  if (entry.messages && entry.messages.length > 0) return entry.messages.join('\n\n')
  return ''
}

const renderArtifactContent = (artifact: FlowiseArtifact, message: Message) => {
  const normalizedType = (artifact.type ?? artifact.mime ?? '').toLowerCase()
  const rawData = typeof artifact.data === 'string' ? artifact.data : ''
  const widthPct = typeof artifact.render?.widthPct === 'number' ? artifact.render.widthPct : undefined
  const hideTable = artifact.render?.hideTable === true

  if (isImageArtifactType(normalizedType)) {
    const src = resolveArtifactSource(rawData, message)
    if (!src) return null
    const style = widthPct
      ? {
          width: `${Math.min(Math.max(widthPct, 10), 100)}%`,
          maxWidth: '1000px',
          minWidth: '520px',
          display: 'block',
          margin: '0 auto',
        }
      : undefined
    return <img src={src} alt={artifact.name ?? 'Flowise artifact'} className="artifact-image" style={style} />
  }

  if (isHtmlArtifact(normalizedType)) {
    return <div className="artifact-html" dangerouslySetInnerHTML={{ __html: rawData }} />
  }

  const textContent = rawData || (artifact.data !== undefined ? JSON.stringify(artifact.data, null, 2) : '')
  if (!textContent || hideTable) return null

  return (
    <pre className="artifact-code">
      <code>{textContent}</code>
    </pre>
  )
}

const resolveArtifactSource = (data: string, message: Message): string | null => {
  if (!data) return null
  if (data.startsWith('FILE-STORAGE::')) {
    const fileEndpoint = getFlowiseFileEndpoint()
    if (!fileEndpoint || !CHATFLOW_ID || !message.chatId) return null
    const params = new URLSearchParams({
      chatflowId: CHATFLOW_ID,
      chatId: message.chatId,
      fileName: data.replace('FILE-STORAGE::', ''),
    })
    return `${fileEndpoint}?${params.toString()}`
  }
  return data
}

const isImageArtifactType = (value: string) => {
  if (!value) return false
  return ['png', 'jpeg', 'jpg', 'gif', 'webp', 'image/'].some((token) => value.includes(token))
}

const isHtmlArtifact = (value: string) => {
  if (!value) return false
  return value === 'html' || value.includes('text/html')
}
