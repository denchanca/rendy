import { useEffect, useRef, useState } from 'react'
import type { OpenAIStatusState } from '../../config/chat'
import type { RecentPrompt } from '../../types'
import { formatRecentLabel, truncatePrompt } from '../../utils/chatHelpers'

type MainHeaderProps = {
  openAIStatus: OpenAIStatusState
  recentPrompts: RecentPrompt[]
  onSelectRecent: (thread: RecentPrompt) => void
}

export const MainHeader = ({ openAIStatus, recentPrompts, onSelectRecent }: MainHeaderProps) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const historyMenuRef = useRef<HTMLDivElement | null>(null)

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

  const handleHistorySelect = (thread: RecentPrompt) => {
    setIsHistoryOpen(false)
    onSelectRecent(thread)
  }

  return (
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
            onClick={() => setIsHistoryOpen((prev) => !prev)}
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
                  {thread.response && <small className="history-subtitle">{truncatePrompt(thread.response, 80)}</small>}
                  <small className="history-meta">{formatRecentLabel(thread.timestamp)}</small>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
