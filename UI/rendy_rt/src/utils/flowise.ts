import type {
  AgentReasoningEntry,
  Citation,
  FlowiseArtifact,
  FlowiseResponse,
} from '../types'

export type ResponseMeta = {
  chatId?: string
  chatMessageId?: string
  sessionId?: string
}

export type FlowiseResult = {
  answer: string
  citations?: Citation[]
  meta: ResponseMeta
  artifacts?: FlowiseArtifact[]
  agentReasoning?: AgentReasoningEntry[]
  aborted?: boolean
}

export type FlowiseStreamChunk = {
  event?: string
  data?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const mergeMeta = (base: ResponseMeta, next: ResponseMeta): ResponseMeta => ({
  chatId: base.chatId ?? next.chatId,
  chatMessageId: base.chatMessageId ?? next.chatMessageId,
  sessionId: base.sessionId ?? next.sessionId,
})

export const extractResponseMeta = (
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

export const getAllArtifacts = (payload?: FlowiseResponse | FlowiseResponse[]): FlowiseArtifact[] => {
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

export const isChartArtifact = (artifact: FlowiseArtifact): boolean => {
  if (!artifact) return false
  if (typeof artifact.render?.widthPct === 'number') return true
  return isImageArtifactType((artifact.type ?? artifact.mime ?? '').toLowerCase())
}

export const normalizeAgentReasoningPayload = (payload: unknown): AgentReasoningEntry[] => {
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

export const getAllAgentReasoning = (payload?: FlowiseResponse | FlowiseResponse[]): AgentReasoningEntry[] => {
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

export const buildCitations = (payload?: FlowiseResponse | FlowiseResponse[]): Citation[] => {
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

export const stripPreamble = (content: string) =>
  content.replace(
    /^Rendy is initiating AGENT MESH and QUERY Engine\. Stand up and stretch, this may take awhile\.\s*/i,
    '',
  )

export const parseFlowiseAnswer = (payload: FlowiseResponse | FlowiseResponse[] | string | undefined): string => {
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

export const parseFlowiseStreamChunk = (raw: string): FlowiseStreamChunk | null => {
  try {
    const candidate = JSON.parse(raw)
    if (!isRecord(candidate)) return null
    return candidate as FlowiseStreamChunk
  } catch {
    return null
  }
}

export const toResponseMetaChunk = (value: unknown): ResponseMeta => {
  const payload = isRecord(value) ? value : undefined
  return {
    chatId: typeof payload?.chatId === 'string' ? payload.chatId : undefined,
    chatMessageId: typeof payload?.chatMessageId === 'string' ? payload.chatMessageId : undefined,
    sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
  }
}

export const buildAgentReasoningText = (entry: AgentReasoningEntry): string => {
  if (entry.instructions && entry.instructions.trim().length > 0) return entry.instructions
  if (entry.messages && entry.messages.length > 0) return entry.messages.join('\n\n')
  return ''
}

export const isImageArtifactType = (value: string) => {
  if (!value) return false
  return ['png', 'jpeg', 'jpg', 'gif', 'webp', 'image/'].some((token) => value.includes(token))
}

export const isHtmlArtifact = (value: string) => {
  if (!value) return false
  return value === 'html' || value.includes('text/html')
}

type ArtifactSourceContext = {
  chatflowId?: string
  chatId?: string
  fileEndpoint?: string
}

export const resolveArtifactSource = (data: string, context: ArtifactSourceContext): string | null => {
  if (!data) return null
  if (data.startsWith('FILE-STORAGE::')) {
    const { chatflowId, chatId, fileEndpoint } = context
    if (!fileEndpoint || !chatflowId || !chatId) return null
    const params = new URLSearchParams({
      chatflowId,
      chatId,
      fileName: data.replace('FILE-STORAGE::', ''),
    })
    return `${fileEndpoint}?${params.toString()}`
  }
  return data
}
