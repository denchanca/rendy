import type { RefObject } from 'react'
import type { Message } from '../../types'
import type { DownloadFormat } from '../../utils/chatHelpers'
import { MessageCard } from './MessageCard'

type ConversationPanelProps = {
  copiedMessageId: string | null
  initialAssistantMessageId: string
  messages: Message[]
  onCopy: (message: Message) => Promise<void>
  onDownload: (message: Message, format: DownloadFormat) => Promise<void>
  streamAnchorRef: RefObject<HTMLDivElement | null>
}

export const ConversationPanel = ({
  copiedMessageId,
  initialAssistantMessageId,
  messages,
  onCopy,
  onDownload,
  streamAnchorRef,
}: ConversationPanelProps) => (
  <section className="conversation-panel">
    {messages.map((message) => (
      <MessageCard
        key={message.id}
        copiedMessageId={copiedMessageId}
        isInitialGreeting={message.id === initialAssistantMessageId}
        message={message}
        onCopy={onCopy}
        onDownload={onDownload}
      />
    ))}
    <div ref={streamAnchorRef} />
  </section>
)
