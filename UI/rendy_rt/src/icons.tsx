import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & {
  color?: string
}

const defaultColor = '#3B81F6'

export const ClipboardIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </svg>
)

export const ThumbsUpIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
  </svg>
)

export const ThumbsDownIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
  </svg>
)

export const DownloadIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 11l5 5l5 -5" />
    <path d="M12 4v12" />
  </svg>
)

export const SendIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path d="M22 2L11 13" />
    <path d="M22 2L15 22l-4-9-9-4 20-7Z" />
  </svg>
)

export const PaperclipIcon = ({ color = defaultColor, className, ...rest }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path d="M16.5 6.75 7.75 15.5a3 3 0 1 0 4.24 4.24L18 13.73" />
    <path d="M8 8.01 17.25 17a3 3 0 1 0 4.24-4.24L12.5 3.75" />
  </svg>
)
