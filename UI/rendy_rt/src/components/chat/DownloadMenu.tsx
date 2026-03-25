import { DownloadIcon } from '../../icons'

type DownloadMenuOption = {
  label: string
  onSelect: () => void | Promise<void>
}

type DownloadMenuProps = {
  ariaLabel: string
  className?: string
  options: DownloadMenuOption[]
}

export const DownloadMenu = ({ ariaLabel, className, options }: DownloadMenuProps) => {
  const menuClassName = ['download-menu', className].filter(Boolean).join(' ')

  return (
    <div className={menuClassName}>
      <button
        type="button"
        className="icon-button download-trigger"
        aria-label={ariaLabel}
        aria-haspopup="true"
      >
        <DownloadIcon />
      </button>
      <div className="download-options" role="menu">
        {options.map((option) => (
          <button type="button" key={option.label} onClick={() => void option.onSelect()} role="menuitem">
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
