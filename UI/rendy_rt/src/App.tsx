import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentReasoningEntry,
  Citation,
  FlowiseArtifact,
  FlowiseResponse,
  Message,
  RecentPrompt,
} from './types'
import './App.css'
import {
  AUTOSCROLL_STORAGE_KEY,
  CHATFLOW_ID,
  CHATFLOW_STORAGE_KEY,
  FLOWISE_CONFIG_ERROR,
  FLOWISE_DIRECT_API_URL,
  FLOWISE_ERROR_FALLBACK,
  FLOWISE_NO_ANSWER_FALLBACK,
  FLOWISE_STREAMING_ENABLED,
  initialAssistantMessage,
  LEGACY_AUTOSCROLL_STORAGE_KEY,
  LEGACY_CHATFLOW_STORAGE_KEYS,
  RENDY_API_URL,
  STREAMING_NOT_SUPPORTED_ERROR,
} from './config/chat'
import { ComposerPanel } from './components/chat/ComposerPanel'
import { ConversationPanel } from './components/chat/ConversationPanel'
import { MainHeader } from './components/chat/MainHeader'
import { Sidebar } from './components/chat/Sidebar'
import { SuggestionGrid } from './components/chat/SuggestionGrid'
import { useChatSession } from './hooks/useChatSession'
import { useOpenAIStatus } from './hooks/useOpenAIStatus'
import { useRecentPrompts } from './hooks/useRecentPrompts'
import { copyTextToClipboard } from './utils/browser'
import { downloadMarkdownContent } from './utils/chatDownloads'
import {
  buildDownloadFilename,
  buildRecentId,
  buildRecentKey,
  buildThreadDownloadFilename,
  buildThreadMarkdown,
  createMessageId,
  isRendyInsult,
  normalizeProviderLabel,
  type DownloadFormat,
} from './utils/chatHelpers'
import {
  buildCitations,
  extractResponseMeta,
  getAllAgentReasoning,
  getAllArtifacts,
  mergeMeta,
  normalizeAgentReasoningPayload,
  parseFlowiseAnswer,
  parseFlowiseStreamChunk,
  stripPreamble,
  toResponseMetaChunk,
  type FlowiseResult,
  type ResponseMeta,
} from './utils/flowise'

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
  const openAIStatus = useOpenAIStatus()
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const { ensureSessionMeta, rememberSessionMeta, resetSessionMeta } = useChatSession(
    CHATFLOW_STORAGE_KEY,
    LEGACY_CHATFLOW_STORAGE_KEYS,
  )
  const streamAnchorRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const stopRequestedRef = useRef(false)
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
    if (!autoScrollEnabled || !hasConversation) return
    streamAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, autoScrollEnabled, hasConversation])

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

  const upsertRecentPrompt = (prompt: string, providerLabel: string, timestamp: number) => {
    setRecentPrompts((prev) => {
      const key = buildRecentKey(providerLabel, prompt)
      const deduped = prev.filter((entry) => buildRecentKey(entry.provider, entry.prompt) !== key)
      return [
        {
          id: buildRecentId(providerLabel, prompt, timestamp),
          prompt,
          response: undefined,
          timestamp,
          provider: providerLabel,
        },
        ...deduped,
      ].slice(0, 30)
    })
  }

  const syncRecentPromptResponse = (prompt: string, providerLabel: string, response: string) => {
    setRecentPrompts((prev) =>
      prev.map((entry) =>
        buildRecentKey(entry.provider, entry.prompt) === buildRecentKey(providerLabel, prompt)
          ? { ...entry, response }
          : entry,
      ),
    )
  }

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
    upsertRecentPrompt(prompt, providerLabel, userMessage.createdAt)

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
      }))
      return normalized
    }

    if (isRendyInsult(prompt)) {
      const playfulResponse =
        "Hey now, be nice to Rendy. Here's a Not Hotdog instead.\n\n![Not Hotdog](/not-hotdog.png)"
      const meta: ResponseMeta = { chatId: sessionMeta.chatId, sessionId: sessionMeta.sessionId }
      const finalAnswer = finalizeMessage(playfulResponse, undefined, meta)
      syncRecentPromptResponse(prompt, providerLabel, finalAnswer)
      void savePrompt(prompt, finalAnswer, providerLabel)
      setIsLoading(false)
      return
    }

    const payload: Record<string, unknown> = {
      question: prompt,
      chatId: sessionMeta.chatId,
      sessionId: sessionMeta.sessionId,
    }

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
            const parsed = parseFlowiseStreamChunk(ev.data)
            if (!parsed) return

            switch (parsed.event) {
              case 'start':
                mutatePlaceholder({ loading: true })
                break
              case 'token':
                if (typeof parsed.data === 'string' && parsed.data.length > 0) {
                  rawAnswer += parsed.data
                  mutatePlaceholder({ content: stripPreamble(rawAnswer), loading: false })
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
              case 'metadata':
                meta = mergeMeta(meta, toResponseMetaChunk(parsed.data))
                mutatePlaceholder((message) => ({
                  ...message,
                  chatId: meta.chatId ?? message.chatId,
                  chatMessageId: meta.chatMessageId ?? message.chatMessageId,
                  sessionId: meta.sessionId ?? message.sessionId,
                }))
                break
              case 'error':
              case 'abort': {
                const message =
                  typeof parsed.data === 'string' && parsed.data.trim().length > 0
                    ? parsed.data
                    : 'Flowise streaming error.'
                throw new Error(message)
              }
              case 'end':
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
          return {
            answer: stripPreamble(rawAnswer),
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

      return {
        answer: stripPreamble(rawAnswer),
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
      return {
        answer: parseFlowiseAnswer(data),
        citations: buildCitations(data),
        meta: extractResponseMeta(data),
        artifacts: getAllArtifacts(data),
        agentReasoning: getAllAgentReasoning(data),
      }
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
        syncRecentPromptResponse(prompt, providerLabel, finalAnswer)
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
      }))
      syncRecentPromptResponse(prompt, providerLabel, fallback)
      void savePrompt(prompt, fallback, providerLabel)
    } finally {
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
    setComposer(trimmedPrompt)
    composerRef.current?.focus()

    const timestamp = thread.timestamp || Date.now()
    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: trimmedPrompt,
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

  const handleCopy = async (message: Message) => {
    try {
      await copyTextToClipboard(message.content)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (clipboardError) {
      console.error(clipboardError)
      setError('Unable to copy response to clipboard.')
    }
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

  const resetThread = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    stopRequestedRef.current = false
    setIsStreamingResponse(false)
    setIsLoading(false)
    setIsStopRequested(false)
    setMessages([initialAssistantMessage])
    setComposer('')
    setComposerHistory([])
    setComposerHistoryIndex(null)
    setError(null)
    resetSessionMeta()
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
      <Sidebar
        recentPrompts={recentPrompts}
        onResetThread={resetThread}
        onSelectRecent={handleRecentClick}
        onRemoveRecent={removeRecentEntry}
      />

      <main className="main-panel">
        <MainHeader
          openAIStatus={openAIStatus}
          recentPrompts={recentPrompts}
          onSelectRecent={handleRecentClick}
        />

        {!hasConversation && <SuggestionGrid onSelectSuggestion={handleSuggestion} />}

        <ConversationPanel
          copiedMessageId={copiedMessageId}
          initialAssistantMessageId={initialAssistantMessage.id}
          messages={messages}
          onCopy={handleCopy}
          onDownload={handleDownload}
          streamAnchorRef={streamAnchorRef}
        />

        <ComposerPanel
          autoScrollEnabled={autoScrollEnabled}
          composer={composer}
          composerRef={composerRef}
          error={error}
          isLoading={isLoading}
          isStopRequested={isStopRequested}
          isStreamingResponse={isStreamingResponse}
          onComposerChange={setComposer}
          onComposerKeyDown={handleComposerKeyDown}
          onResetThread={resetThread}
          onSendPrompt={() => void sendPrompt()}
          onStopStreaming={handleStopStreaming}
          onThreadDownload={handleThreadDownload}
          onToggleAutoScroll={handleToggleAutoScroll}
        />
      </main>
    </div>
  )
}

export default App
