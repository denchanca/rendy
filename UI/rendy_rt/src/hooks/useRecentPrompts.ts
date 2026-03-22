import { useCallback, useEffect, useState } from 'react'

const RECENTS_STORAGE_KEY = 'rendy_recent_prompts_v1'
const LEGACY_RECENTS_STORAGE_KEY = 'navi_recent_prompts_v1'
const MAX_RECENTS = 20

export type RecentPromptRecord = {
  prompt: string
  response?: string | null
  last_used_at: string
  provider?: string | null
}

const normalizeText = (value: unknown) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeTimestamp = (value: unknown) => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

const normalizeRecord = (value: unknown): RecentPromptRecord | null => {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Record<string, unknown>
  const prompt = normalizeText(candidate.prompt)
  const lastUsedAt = normalizeTimestamp(candidate.last_used_at) ?? new Date().toISOString()
  if (!prompt) return null

  return {
    prompt,
    response: normalizeText(candidate.response) ?? null,
    provider: normalizeText(candidate.provider) ?? null,
    last_used_at: lastUsedAt,
  }
}

const buildRecentKey = (prompt: string, provider?: string | null) => `${provider?.trim() ?? ''}:::${prompt.trim()}`

const sortByMostRecent = (records: RecentPromptRecord[]) =>
  [...records].sort((left, right) => Date.parse(right.last_used_at) - Date.parse(left.last_used_at))

const dedupeRecents = (records: RecentPromptRecord[]) => {
  const map = new Map<string, RecentPromptRecord>()
  for (const record of sortByMostRecent(records)) {
    const key = buildRecentKey(record.prompt, record.provider)
    if (!map.has(key)) {
      map.set(key, record)
    }
  }
  return Array.from(map.values()).slice(0, MAX_RECENTS)
}

const parseStoredRecents = (raw: string | null) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupeRecents(parsed.map(normalizeRecord).filter((record): record is RecentPromptRecord => Boolean(record)))
  } catch {
    return []
  }
}

const persistRecents = (records: RecentPromptRecord[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(records))
  } catch (error) {
    console.warn('Unable to persist recent prompts', error)
  }
}

const readStoredRecents = () => {
  if (typeof window === 'undefined') return []
  try {
    const current = parseStoredRecents(window.localStorage.getItem(RECENTS_STORAGE_KEY))
    if (current.length > 0) return current

    const legacy = parseStoredRecents(window.localStorage.getItem(LEGACY_RECENTS_STORAGE_KEY))
    if (legacy.length > 0) {
      persistRecents(legacy)
      return legacy
    }
  } catch (error) {
    console.warn('Unable to read recent prompts', error)
  }
  return []
}

export function useRecentPrompts() {
  const [recents, setRecents] = useState<RecentPromptRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRecents(readStoredRecents())
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to load recent prompts')
    } finally {
      setLoading(false)
    }
  }, [])

  const savePrompt = useCallback(async (prompt: string, response?: string, provider?: string | null) => {
    const normalizedPrompt = normalizeText(prompt)
    if (!normalizedPrompt) return

    const nextRecord: RecentPromptRecord = {
      prompt: normalizedPrompt,
      response: normalizeText(response) ?? null,
      provider: normalizeText(provider) ?? null,
      last_used_at: new Date().toISOString(),
    }

    setRecents((prev) => {
      const next = dedupeRecents([nextRecord, ...prev])
      persistRecents(next)
      return next
    })
  }, [])

  const deletePrompt = useCallback(async (prompt: string, provider?: string | null) => {
    const normalizedPrompt = normalizeText(prompt)
    if (!normalizedPrompt) return

    setRecents((prev) => {
      const next = prev.filter((record) => buildRecentKey(record.prompt, record.provider) !== buildRecentKey(normalizedPrompt, provider))
      persistRecents(next)
      return next
    })
  }, [])

  useEffect(() => {
    void fetchRecents()
  }, [fetchRecents])

  return { recents, loading, error, fetchRecents, savePrompt, deletePrompt }
}
