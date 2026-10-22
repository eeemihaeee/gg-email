import type { SVGProps } from 'react'

export type IconName =
  | 'inbox'
  | 'send'
  | 'draft'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'folder'
  | 'star'
  | 'star-filled'
  | 'reply'
  | 'reply-all'
  | 'forward'
  | 'search'
  | 'refresh'
  | 'settings'
  | 'plus'
  | 'paperclip'
  | 'image'
  | 'close'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'mail'
  | 'shield'
  | 'download'
  | 'more'
  | 'spinner'
  | 'lock'
  | 'warning'
  | 'external'
  | 'trash-empty'
  | 'info'
  | 'palette'

const PATHS: Record<IconName, string> = {
  inbox: 'M3 7.5 5.2 4h13.6L21 7.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Zm0 0h5l1.5 2.5h5L16 7.5h5',
  send: 'm3 11 18-8-8 18-2.5-7.5L3 11Z',
  draft: 'M4 4h10l6 6v10H4V4Zm10 0v6h6',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13',
  junk: 'M12 3 3 20h18L12 3Zm0 6v5m0 3h.01',
  archive: 'M3 5h18v4H3V5Zm2 4v11h14V9M10 13h4',
  folder: 'M3 6h6l2 2h10v11H3V6Z',
  star: 'm12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9L12 3.6Z',
  'star-filled':
    'm12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9L12 3.6Z',
  reply: 'M9 7 4 12l5 5M4 12h9a7 7 0 0 1 7 7',
  'reply-all': 'M8 7 3 12l5 5M13 7l-5 5 5 5M13 12h4a6 6 0 0 1 6 6',
  forward: 'm15 7 5 5-5 5m5-5h-9a7 7 0 0 0-7 7',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.8.2L20 21',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5c0-.6-.1-1.1-.2-1.6l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.7-1.6L14.5 2h-4l-.3 2.4a8 8 0 0 0-2.7 1.6l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 3.2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.7 1.6l.3 2.4h4l.3-2.4a8 8 0 0 0 2.7-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6Z',
  plus: 'M12 5v14M5 12h14',
  paperclip: 'M20 11.5 12.3 19a4.5 4.5 0 0 1-6.4-6.4l7.8-7.8a3 3 0 0 1 4.2 4.2l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7-7',
  image: 'M4 5h16v14H4V5Zm0 10 4.5-4.5L13 15l3-3 4 4M9 9.5h.01',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 13 4 4L19 7',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  mail: 'M3 6h18v12H3V6Zm0 1 9 7 9-7',
  shield: 'M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  spinner: 'M12 3a9 9 0 1 0 9 9',
  lock: 'M6 11h12v9H6v-9Zm3 0V8a3 3 0 0 1 6 0v3',
  warning: 'M12 4 2 20h20L12 4Zm0 6v5m0 3h.01',
  external: 'M14 4h6v6m0-6-8 8M19 14v6H4V5h6',
  'trash-empty': 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M12 11v6',
  palette:
    'M12 3a9 9 0 0 0 0 18h1.6a1.9 1.9 0 0 0 1.4-3.2 1.9 1.9 0 0 1 1.4-3.2H19a3 3 0 0 0 3-3A9 9 0 0 0 12 3Zm-4 9h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01'
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...rest }: IconProps): React.JSX.Element {
  const filled = name === 'star-filled'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
