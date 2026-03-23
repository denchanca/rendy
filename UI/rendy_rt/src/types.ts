export type Role = 'user' | 'assistant'

export interface Citation {
  id: string
  title: string
  url?: string
  meta?: string
}

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  loading?: boolean
  citations?: Citation[]
  artifacts?: FlowiseArtifact[]
  agentReasoning?: AgentReasoningEntry[]
  chatId?: string
  chatMessageId?: string
  sessionId?: string
  feedback?: 'THUMBS_UP' | 'THUMBS_DOWN' | null
  feedbackSubmitting?: boolean
}

export interface RecentPrompt {
  id: string
  prompt: string
  timestamp: number
  response?: string
  provider?: string | null
}

export interface FlowiseDocument {
  pageContent?: string
  metadata?: Record<string, unknown>
}

export interface FlowiseArtifact {
  type?: string
  mime?: string
  name?: string
  data?: string
  render?: {
    widthPct?: number
    hideTable?: boolean
  }
  [key: string]: unknown
}

export interface AgentReasoningEntry {
  agentName?: string
  messages?: string[]
  usedTools?: unknown[]
  artifacts?: FlowiseArtifact[]
  instructions?: string
  nextAgent?: string
}

// Flowise prediction payloads vary by chatflow, so we keep this flexible.
export interface FlowiseResponse {
  text?: string
  answer?: string
  result?: string
  output?: string
  response?: string
  message?: string
  data?: FlowiseResponse | FlowiseResponse[]
  sourceDocuments?: FlowiseDocument[]
  artifacts?: FlowiseArtifact[]
  agentReasoning?: AgentReasoningEntry[]
  sessionId?: string
  chatId?: string
  chatMessageId?: string
  [key: string]: unknown
}
