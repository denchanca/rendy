import type { ReactNode } from 'react'
import { DEFAULT_LLM_PROVIDER } from '../config/chat'
import type { Message } from '../types'

export const createMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Math.random().toString(36).slice(2, 10)}`

export const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

const formatDateTime = (value: number) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

export const formatRecentLabel = (value: number) => {
  const now = new Date()
  const date = new Date(value)

  const isSameDay = now.toDateString() === date.toDateString()
  if (isSameDay) {
    return `Today, ${formatTimestamp(value)}`
  }

  const oneDayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.floor((now.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / oneDayMs)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(value)
  }

  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value)
}

export const truncatePrompt = (text: string, max = 60) => {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}

export const isRendyInsult = (text: string) => {
  if (!text) return false
  const normalized = text.toLowerCase()
  if (!normalized.includes('rendy')) return false
  const insults = ['suck', 'stupid', 'always wrong', 'you are wrong', 'youre wrong', 'terrible', 'awful', 'hate you']
  return insults.some((token) => normalized.includes(token))
}

export const extractTextFromNode = (node: ReactNode): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  return ''
}

export const convertMarkdownToPlainText = (markdown: string) => {
  if (!markdown) return ''
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/>+\s?/g, '')
    .replace(/\r/g, '')
    .trim()
}

const escapeRtf = (value: string) => value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}')

type TableAlignment = 'left' | 'center' | 'right'

type TableCell = {
  raw: string
  formatted: string
}

type TableRow = {
  cells: TableCell[]
  header: boolean
}

export const convertMarkdownToRichText = (markdown: string) => {
  const lines = markdown.split(/\r?\n/)
  const rtfLines: string[] = []
  const header = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}{\\f1 Courier New;}}'

  const applyInlineFormatting = (input: string) => {
    let result = escapeRtf(input)
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    result = result.replace(/`([^`]+)`/g, (_match, code) => `\\f1 ${code}\\f0`)
    result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => `\\b ${text}\\b0`)
    result = result.replace(/__([^_]+)__/g, (_match, text) => `\\b ${text}\\b0`)
    result = result.replace(/\*([^*]+)\*/g, (_match, text) => `\\i ${text}\\i0`)
    result = result.replace(/_([^_]+)_/g, (_match, text) => `\\i ${text}\\i0`)
    return result
  }

  const isTableRow = (value: string) => {
    if (!value || !value.includes('|')) return false
    if (/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(value)) return false
    return true
  }

  const isSeparatorRow = (value: string) => /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(value)

  const parseTableRow = (value: string): TableCell[] => {
    const trimmed = value.trim().replace(/^\|/, '').replace(/\|$/, '')
    return trimmed.split('|').map((cell) => {
      const raw = cell.trim()
      return { raw, formatted: applyInlineFormatting(raw) }
    })
  }

  const parseAlignmentRow = (value: string): TableAlignment[] => {
    const trimmed = value.trim().replace(/^\|/, '').replace(/\|$/, '')
    if (!trimmed) return []
    return trimmed.split('|').map((cell) => {
      const segment = cell.trim()
      const startsWithColon = segment.startsWith(':')
      const endsWithColon = segment.endsWith(':')
      if (startsWithColon && endsWithColon) return 'center'
      if (endsWithColon) return 'right'
      return 'left'
    })
  }

  const emitTable = (rows: TableRow[], alignments: TableAlignment[]) => {
    if (rows.length === 0) return
    const columnCount = Math.max(...rows.map((row) => row.cells.length), alignments.length)
    if (columnCount === 0) return

    const normalizedAlignments = Array.from({ length: columnCount }, (_, idx) => alignments[idx] ?? 'left')
    const columnCharWidths = Array.from({ length: columnCount }, () => 1)
    rows.forEach((row) => {
      row.cells.forEach((cell, idx) => {
        columnCharWidths[idx] = Math.max(columnCharWidths[idx], cell.raw.length || 1)
      })
    })

    const targetTableWidth = 9000
    const minColumnWidth = 1400
    const totalChars = columnCharWidths.reduce((sum, value) => sum + value, 0) || columnCount
    const columnWidths = columnCharWidths.map((count) => {
      const proportionalWidth = Math.round((count / totalChars) * targetTableWidth)
      return Math.max(minColumnWidth, proportionalWidth)
    })
    const widthSum = columnWidths.reduce((sum, width) => sum + width, 0)
    if (widthSum < targetTableWidth && columnWidths.length > 0) {
      columnWidths[columnWidths.length - 1] += targetTableWidth - widthSum
    }

    let runningWidth = 0
    const boundString = columnWidths
      .map((width) => {
        runningWidth += width
        return `\\cellx${runningWidth}`
      })
      .join('')

    rows.forEach((row) => {
      rtfLines.push(`\\trowd\\trgaph108${boundString}`)
      const cellEntries: string[] = []
      for (let idx = 0; idx < columnCount; idx += 1) {
        const alignment = normalizedAlignments[idx]
        const alignmentTag = alignment === 'center' ? '\\qc' : alignment === 'right' ? '\\qr' : '\\ql'
        const cell = row.cells[idx]
        const formatted = cell ? (row.header ? `\\b ${cell.formatted}\\b0` : cell.formatted) : ''
        cellEntries.push(`\\pard\\intbl${alignmentTag}\\sa40\\sb40\\f0\\fs24 ${formatted}\\cell`)
      }
      rtfLines.push(`${cellEntries.join(' ')}\\row`)
    })
    rtfLines.push('\\pard')
  }

  let i = 0
  while (i < lines.length) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (line && isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1].trim())) {
      const rows: TableRow[] = []
      const alignments = parseAlignmentRow(lines[i + 1])
      rows.push({ cells: parseTableRow(line), header: true })
      i += 2
      while (i < lines.length) {
        const candidate = lines[i].trim()
        if (!candidate || !candidate.includes('|')) break
        if (isSeparatorRow(candidate)) {
          i += 1
          continue
        }
        rows.push({ cells: parseTableRow(candidate), header: false })
        i += 1
      }
      emitTable(rows, alignments)
      if (i >= lines.length || (lines[i] && lines[i].trim().length > 0)) {
        rtfLines.push('\\par')
      }
      continue
    }

    if (!line) {
      rtfLines.push('\\par')
      i += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = applyInlineFormatting(headingMatch[2])
      const sizeMap: Record<number, number> = { 1: 48, 2: 40, 3: 32, 4: 28, 5: 24, 6: 22 }
      const size = sizeMap[level] ?? 24
      rtfLines.push(`\\pard\\sa200\\sb100\\f0\\fs${size}\\b ${text}\\b0\\fs24\\par`)
      i += 1
      continue
    }

    const bulletMatch = line.match(/^[-*+]\s+(.*)$/)
    if (bulletMatch) {
      const text = applyInlineFormatting(bulletMatch[1])
      rtfLines.push(`\\pard\\li720\\fi-360\\sa80\\sb40\\f0\\fs24\\bullet\\tab ${text}\\par`)
      i += 1
      continue
    }

    const orderedMatch = line.match(/^(\d+)[.)]\s+(.*)$/)
    if (orderedMatch) {
      const text = applyInlineFormatting(orderedMatch[2])
      rtfLines.push(`\\pard\\li720\\fi-360\\sa80\\sb40\\f0\\fs24 ${orderedMatch[1]}.\\tab ${text}\\par`)
      i += 1
      continue
    }

    const paragraph = applyInlineFormatting(line)
    rtfLines.push(`\\pard\\sa120\\sb0\\f0\\fs24 ${paragraph}\\par`)
    i += 1
  }

  return `${header}\n${rtfLines.join('\n')}\n}`
}

export type DownloadFormat = 'txt' | 'md' | 'rtf' | 'pdf'

export const normalizeProviderLabel = (value?: string | null) => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return DEFAULT_LLM_PROVIDER
  return trimmed
}

export const buildRecentKey = (provider: string | null | undefined, prompt: string) =>
  `${normalizeProviderLabel(provider)}:::${prompt}`

export const buildRecentId = (provider: string | null | undefined, prompt: string, timestamp: number | string) =>
  `recent-${buildRecentKey(provider, prompt)}:::${timestamp}`

export const buildDownloadFilename = (message: Message, extension: DownloadFormat) => {
  const createdAt = new Date(message.createdAt || Date.now())
  const fallback = new Date()
  const safeDate = Number.isNaN(createdAt.getTime()) ? fallback : createdAt
  const iso = safeDate.toISOString().replace(/[:.]/g, '-')
  return `rendy-response-${iso}.${extension}`
}

export const buildThreadDownloadFilename = (extension: DownloadFormat) => {
  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  return `rendy-thread-${iso}.${extension}`
}

const formatUserPromptForTranscript = (content: string) => {
  const normalized = content.trim()
  if (!normalized) return ''
  return normalized
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

export const buildThreadMarkdown = (entries: Message[]) => {
  const available = entries.filter((message) => message.content && message.content.trim().length > 0)
  if (available.length === 0) {
    return '# Rendy Conversation\n\n_No messages available yet._'
  }

  const blocks = available.map((message) => {
    const speaker = message.role === 'assistant' ? 'Rendy' : 'You'
    const timestamp = formatDateTime(message.createdAt ?? Date.now())
    const body =
      message.role === 'assistant' ? message.content.trim() : formatUserPromptForTranscript(message.content)
    return `## ${speaker} · ${timestamp}\n\n${body}`.trim()
  })

  return ['# Rendy Conversation', ...blocks].join('\n\n')
}
