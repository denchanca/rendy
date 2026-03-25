import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { navShortcuts } from '../../config/chat'
import type { RecentPrompt } from '../../types'
import { formatRecentLabel, truncatePrompt } from '../../utils/chatHelpers'

type SidebarProps = {
  recentPrompts: RecentPrompt[]
  onResetThread: () => void
  onSelectRecent: (thread: RecentPrompt) => void
  onRemoveRecent: (id: string) => void
}

export const Sidebar = ({
  recentPrompts,
  onResetThread,
  onSelectRecent,
  onRemoveRecent,
}: SidebarProps) => {
  const handleRemoveRecent = (event: ReactMouseEvent | ReactKeyboardEvent, id: string) => {
    event.stopPropagation()
    if ('key' in event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
    }
    onRemoveRecent(id)
  }

  return (
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

      <button type="button" className="new-thread" onClick={onResetThread}>
        + New thread
      </button>

      <div className="sidebar-section">
        <p className="section-label">Recents</p>
        <div className="thread-list">
          {recentPrompts.length === 0 ? (
            <p className="thread-empty">No history yet.</p>
          ) : (
            recentPrompts.map((thread) => (
              <button type="button" key={thread.id} className="thread-card" onClick={() => onSelectRecent(thread)}>
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
                {thread.response && <span className="thread-response">{truncatePrompt(thread.response, 80)}</span>}
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
  )
}
