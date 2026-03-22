import { useCallback, useEffect, useRef } from 'react'

const createSessionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Math.random().toString(36).slice(2, 10)}`

const sanitizeId = (value?: string | null) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type StoredSession = {
  chatId: string | null
  sessionId: string | null
}

type SessionMeta = {
  chatId: string
  sessionId: string
}

const ensureSerializableSession = (payload: StoredSession): StoredSession => ({
  chatId: sanitizeId(payload.chatId),
  sessionId: sanitizeId(payload.sessionId),
})

const parseStoredSession = (raw: string): StoredSession | null => {
  try {
    const parsed = JSON.parse(raw) as StoredSession
    const normalized = ensureSerializableSession(parsed)
    if (normalized.chatId || normalized.sessionId) return normalized
  } catch {
    const legacy = sanitizeId(raw)
    if (legacy) return { chatId: legacy, sessionId: null }
  }
  return null
}

export function useChatSession(storageKey: string, legacyStorageKeys: string[] = []) {
  const sessionRef = useRef<StoredSession>({ chatId: null, sessionId: null })

  const readStoredSession = useCallback(() => {
    if (typeof window === 'undefined') return null
    for (const key of [storageKey, ...legacyStorageKeys]) {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) continue
        const normalized = parseStoredSession(raw)
        if (!normalized) continue
        if (key !== storageKey) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(normalized))
          } catch (persistError) {
            console.warn('Unable to migrate stored chat session', persistError)
          }
        }
        return normalized
      } catch (err) {
        console.warn('Unable to read stored chat session', err)
      }
    }
    return null
  }, [legacyStorageKeys, storageKey])

  const persistSession = useCallback(
    (payload: StoredSession) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(payload))
      } catch (err) {
        console.warn('Unable to persist chat session', err)
      }
    },
    [storageKey],
  )

  const assignSessionMeta = useCallback((): StoredSession => {
    const freshId = createSessionId()
    const payload: StoredSession = { chatId: freshId, sessionId: freshId }
    persistSession(payload)
    return payload
  }, [persistSession])

  const resolveActiveSessionMeta = useCallback(() => {
    const existing = readStoredSession()
    if (existing) {
      sessionRef.current = existing
      return existing
    }
    const assigned = assignSessionMeta()
    sessionRef.current = assigned
    return assigned
  }, [assignSessionMeta, readStoredSession])

  const ensureSessionMeta = useCallback((): SessionMeta => {
    const current = sessionRef.current ?? resolveActiveSessionMeta()
    let next: StoredSession = { ...current }
    let changed = false

    if (!sanitizeId(next.chatId) && sanitizeId(next.sessionId)) {
      next.chatId = next.sessionId
      changed = true
    }

    if (!sanitizeId(next.chatId) && !sanitizeId(next.sessionId)) {
      next = assignSessionMeta()
      changed = true
    }

    if (!sanitizeId(next.sessionId) && sanitizeId(next.chatId)) {
      next.sessionId = next.chatId
      changed = true
    }

    if (changed) {
      sessionRef.current = next
      persistSession(next)
    }

    return {
      chatId: next.chatId as string,
      sessionId: next.sessionId as string,
    }
  }, [assignSessionMeta, persistSession, resolveActiveSessionMeta])

  const rememberSessionMeta = useCallback(
    (incoming?: Partial<SessionMeta>) => {
      if (!incoming) return
      const current = sessionRef.current ?? resolveActiveSessionMeta()
      const next: StoredSession = { ...current }
      let changed = false

      const normalizedChatId = sanitizeId(incoming.chatId ?? null)
      if (normalizedChatId && normalizedChatId !== next.chatId) {
        next.chatId = normalizedChatId
        changed = true
      }

      const normalizedSessionId = sanitizeId(incoming.sessionId ?? null)
      if (normalizedSessionId && normalizedSessionId !== next.sessionId) {
        next.sessionId = normalizedSessionId
        changed = true
      }

      if (!changed) return

      if (!next.chatId && next.sessionId) next.chatId = next.sessionId
      if (!next.sessionId && next.chatId) next.sessionId = next.chatId

      sessionRef.current = next
      persistSession(next)
    },
    [persistSession, resolveActiveSessionMeta],
  )

  const resetSessionMeta = useCallback(() => {
    const next = assignSessionMeta()
    sessionRef.current = next
    return {
      chatId: next.chatId as string,
      sessionId: next.sessionId as string,
    }
  }, [assignSessionMeta])

  useEffect(() => {
    sessionRef.current = resolveActiveSessionMeta()
  }, [resolveActiveSessionMeta])

  return {
    sessionRef,
    ensureSessionMeta,
    rememberSessionMeta,
    resetSessionMeta,
  }
}
