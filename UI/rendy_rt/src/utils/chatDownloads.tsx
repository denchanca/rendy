import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { renderToStaticMarkup } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
import { triggerBlobDownload } from './browser'
import { convertMarkdownToPlainText, convertMarkdownToRichText, type DownloadFormat } from './chatHelpers'

export const downloadMarkdownContent = async (markdown: string, format: DownloadFormat, filename: string) => {
  if (typeof document === 'undefined') return

  if (format === 'pdf') {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 36
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-9999px'
    container.style.top = '0'
    container.style.width = `${pageWidth - margin * 2}px`

    const pdfStyles = `
      <style>
        .pdf-root { font-family: 'Inter', Arial, sans-serif; color: #f7f8fb; background: #050b14; padding: 32px; line-height: 1.7; }
        .pdf-root h1, .pdf-root h2, .pdf-root h3, .pdf-root h4 { color: #ffffff; margin: 24px 0 12px; }
        .pdf-root p { margin: 0 0 12px; }
        .pdf-root ul, .pdf-root ol { margin: 0 0 12px 24px; }
        .pdf-root li { margin-bottom: 6px; }
        .pdf-root table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11pt; }
        .pdf-root th, .pdf-root td { border: 1px solid rgba(247,248,251,0.2); padding: 8px 10px; }
        .pdf-root pre { background: #0c1224; border-radius: 12px; padding: 16px; color: #f7f8fb; overflow: auto; }
        .pdf-root code { background: #0c1224; color: #f7f8fb; padding: 2px 6px; border-radius: 6px; font-family: 'Courier New', monospace; }
        .pdf-root blockquote { border-left: 4px solid #57c6ff; padding-left: 12px; color: rgba(247,248,251,0.75); margin: 16px 0; }
        .pdf-root a { color: #57c6ff; text-decoration: none; }
      </style>
    `

    container.innerHTML = `${pdfStyles}<div class="pdf-root">${renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} rel="noreferrer" target="_blank" />,
          code: (nodeProps) => {
            const { inline, className, children } = nodeProps as {
              inline?: boolean
              className?: string
              children?: ReactNode
            }

            return inline ? (
              <code className={className}>{children}</code>
            ) : (
              <pre className={className}>
                <code>{children}</code>
              </pre>
            )
          },
        }}
      >
        {markdown}
      </ReactMarkdown>,
    )}</div>`

    document.body.appendChild(container)
    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        width: container.offsetWidth,
        height: container.offsetHeight,
        backgroundColor: '#050b14',
      })

      const imgData = canvas.toDataURL('image/png')
      const imgWidth = pageWidth - margin * 2
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const usableHeight = pageHeight - margin * 2

      let heightLeft = imgHeight
      const position = margin

      doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST')
      heightLeft -= usableHeight

      while (heightLeft > 0) {
        doc.addPage()
        doc.addImage(imgData, 'PNG', margin, heightLeft - imgHeight + margin, imgWidth, imgHeight, undefined, 'FAST')
        heightLeft -= usableHeight
      }
    } finally {
      document.body.removeChild(container)
    }

    doc.save(filename)
    return
  }

  const mimeType =
    format === 'md'
      ? 'text/markdown;charset=utf-8'
      : format === 'rtf'
        ? 'application/rtf'
        : 'text/plain;charset=utf-8'

  const content =
    format === 'md'
      ? markdown
      : format === 'rtf'
        ? convertMarkdownToRichText(markdown)
        : convertMarkdownToPlainText(markdown)

  triggerBlobDownload([content], filename, mimeType)
}
