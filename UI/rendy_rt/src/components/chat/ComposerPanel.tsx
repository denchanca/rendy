import type { KeyboardEvent, RefObject } from 'react'
import type { DownloadFormat } from '../../utils/chatHelpers'
import { DownloadMenu } from './DownloadMenu'

type ComposerPanelProps = {
  autoScrollEnabled: boolean
  composer: string
  composerRef: RefObject<HTMLTextAreaElement | null>
  error: string | null
  isLoading: boolean
  isStopRequested: boolean
  isStreamingResponse: boolean
  onComposerChange: (value: string) => void
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onResetThread: () => void
  onSendPrompt: () => void
  onStopStreaming: () => void
  onThreadDownload: (format: DownloadFormat) => Promise<void>
  onToggleAutoScroll: () => void
}

export const ComposerPanel = ({
  autoScrollEnabled,
  composer,
  composerRef,
  error,
  isLoading,
  isStopRequested,
  isStreamingResponse,
  onComposerChange,
  onComposerKeyDown,
  onResetThread,
  onSendPrompt,
  onStopStreaming,
  onThreadDownload,
  onToggleAutoScroll,
}: ComposerPanelProps) => {
  const threadDownloadOptions = [
    { label: 'Full chat (.txt)', onSelect: () => onThreadDownload('txt') },
    { label: 'Full chat (.md)', onSelect: () => onThreadDownload('md') },
    { label: 'Full chat (.rtf)', onSelect: () => onThreadDownload('rtf') },
    { label: 'Full chat (.pdf)', onSelect: () => onThreadDownload('pdf') },
  ]

  return (
    <section className="composer-panel">
      <div className="composer-shell">
        <textarea
          ref={composerRef}
          value={composer}
          placeholder="Ask Rendy anything…"
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          rows={3}
        />
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
                onChange={onToggleAutoScroll}
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
              onClick={onResetThread}
              aria-label="Start a new thread"
              title="Start a new thread"
            >
              +
            </button>
            <DownloadMenu
              ariaLabel="Download full chat thread"
              className="thread-download-menu"
              options={threadDownloadOptions}
            />
            {isStreamingResponse && (
              <button
                type="button"
                className="stop-button"
                onClick={onStopStreaming}
                disabled={isStopRequested}
              >
                {isStopRequested ? 'Stopping…' : 'Stop'}
              </button>
            )}
            <button
              type="button"
              className="ask-button"
              onClick={onSendPrompt}
              disabled={!composer.trim() || isLoading}
            >
              {isLoading ? 'Thinking…' : 'Ask Rendy'}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="error-banner">{error}</p>}
    </section>
  )
}
