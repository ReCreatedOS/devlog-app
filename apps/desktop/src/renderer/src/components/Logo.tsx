import type { ReactNode } from 'react'

/**
 * Uygulama markası: bir zaman ekseni (dikey omurga) üzerinde üç kayıt.
 *
 * Uygulama ikonuyla (`build/make-icon.mjs`) aynı anatomi — liste satırının
 * kendisi: solda severity noktası, sağında satır. En üstteki nokta vurgu
 * renginde, yani "en yeni / açık olan".
 */
export function Logo({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M3.75 3.25v9.5"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="3.75" cy="4.25" r="1.9" fill="var(--primary)" />
      <circle cx="3.75" cy="8" r="1.4" fill="currentColor" fillOpacity="0.5" />
      <circle cx="3.75" cy="11.75" r="1.4" fill="currentColor" fillOpacity="0.3" />
      <path
        d="M7.5 4.25h5.75M7.5 8h4.25M7.5 11.75h2.75"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  )
}
