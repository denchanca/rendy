import type { HTMLAttributes, ReactNode } from 'react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CHATFLOW_ID, getFlowiseFileEndpoint } from '../../config/chat'
import { ClipboardIcon, DownloadIcon } from '../../icons'
import type { AgentReasoningEntry, FlowiseArtifact, Message } from '../../types'
import { copyTextToClipboard, triggerBlobDownload } from '../../utils/browser'
import { formatTimestamp, extractTextFromNode, type DownloadFormat } from '../../utils/chatHelpers'
import {
  buildAgentReasoningText,
  isChartArtifact,
  isHtmlArtifact,
  isImageArtifactType,
  resolveArtifactSource,
} from '../../utils/flowise'
import { DownloadMenu } from './DownloadMenu'

type MessageCardProps = {
  copiedMessageId: string | null
  isInitialGreeting: boolean
  message: Message
  onCopy: (message: Message) => Promise<void>
  onDownload: (message: Message, format: DownloadFormat) => Promise<void>
}

export const MessageCard = ({
  copiedMessageId,
  isInitialGreeting,
  message,
  onCopy,
  onDownload,
}: MessageCardProps) => {
  const downloadOptions = [
    { label: 'Text (.txt)', onSelect: () => onDownload(message, 'txt') },
    { label: 'Markdown (.md)', onSelect: () => onDownload(message, 'md') },
    { label: 'Rich Text (.rtf)', onSelect: () => onDownload(message, 'rtf') },
    { label: 'PDF (.pdf)', onSelect: () => onDownload(message, 'pdf') },
  ]

  return (
    <article className={`message-card ${message.role}`}>
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
              a: (props) => <a {...props} rel="noreferrer" target="_blank" />,
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
              onClick={() => void onCopy(message)}
              aria-label="Copy response"
            >
              <ClipboardIcon color={copiedMessageId === message.id ? '#C6FF7F' : undefined} />
            </button>
            {copiedMessageId === message.id && <span className="action-hint">Copied</span>}
          </>
        )}
        {message.role === 'assistant' && !message.loading && !isInitialGreeting && (
          <DownloadMenu ariaLabel="Download response" options={downloadOptions} />
        )}
      </div>
    </article>
  )
}

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
      await copyTextToClipboard(codeText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Unable to copy code block.', error)
    }
  }

  const handleDownload = () => {
    try {
      const filename = `rendy-code-${Date.now()}.${safeExtension}`
      triggerBlobDownload([codeText], filename, 'text/plain;charset=utf-8')
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

const renderArtifactContent = (artifact: FlowiseArtifact, message: Message) => {
  const normalizedType = (artifact.type ?? artifact.mime ?? '').toLowerCase()
  const rawData = typeof artifact.data === 'string' ? artifact.data : ''
  const widthPct = typeof artifact.render?.widthPct === 'number' ? artifact.render.widthPct : undefined
  const hideTable = artifact.render?.hideTable === true

  if (isImageArtifactType(normalizedType)) {
    const src = resolveArtifactSource(rawData, {
      chatflowId: CHATFLOW_ID,
      chatId: message.chatId,
      fileEndpoint: getFlowiseFileEndpoint(),
    })
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
