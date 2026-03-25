import { useEffect, useState } from 'react'
import {
  buildOpenAIStatusDescription,
  deriveAggregateOpenAIIndicator,
  deriveSummaryIndicator,
  OPENAI_STATUS_POLL_INTERVAL,
  OPENAI_STATUS_SUMMARY_URL,
  selectOpenAIComponents,
  type OpenAIStatusState,
  type OpenAIStatusSummaryResponse,
} from '../config/chat'

const initialStatus: OpenAIStatusState = {
  indicator: 'unknown',
  description: 'Checking API…',
}

export function useOpenAIStatus() {
  const [openAIStatus, setOpenAIStatus] = useState<OpenAIStatusState>(initialStatus)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let isMounted = true

    const fetchOpenAIStatus = async () => {
      try {
        const response = await fetch(OPENAI_STATUS_SUMMARY_URL, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`OpenAI status returned ${response.status}`)
        }

        const payload = (await response.json()) as OpenAIStatusSummaryResponse
        if (!isMounted) return

        const components = selectOpenAIComponents(payload?.components)
        let indicator = deriveAggregateOpenAIIndicator(components)
        if (indicator === 'unknown') {
          indicator = deriveSummaryIndicator(payload?.status?.indicator)
        }

        setOpenAIStatus({
          indicator,
          description: buildOpenAIStatusDescription(indicator),
        })
      } catch (statusError) {
        console.error('Unable to retrieve OpenAI status.', statusError)
        if (!isMounted) return

        setOpenAIStatus((prev) =>
          prev.indicator === 'unknown'
            ? { indicator: 'yellow', description: buildOpenAIStatusDescription('yellow') }
            : prev,
        )
      }
    }

    void fetchOpenAIStatus()
    const intervalId = window.setInterval(() => {
      void fetchOpenAIStatus()
    }, OPENAI_STATUS_POLL_INTERVAL)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  return openAIStatus
}
