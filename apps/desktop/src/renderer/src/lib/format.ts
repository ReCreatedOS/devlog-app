import { localDayKey } from '@devlog/core/shared'
import type { EntryStatus, Severity } from '@devlog/core/shared'

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

const pad = (n: number): string => String(n).padStart(2, '0')

export function timeOfDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function dayKey(iso: string): string {
  return localDayKey(iso)
}

/** `Bugün · 30 Temmuz Çarşamba` — gün başlıkları için. */
export function dayHeading(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return key
  const date = new Date(year, month - 1, day)
  const todayKey = localDayKey(new Date().toISOString())
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = localDayKey(yesterday.toISOString())

  const label = `${day} ${MONTHS[month - 1]} ${WEEKDAYS[date.getDay()]}`
  if (key === todayKey) return `Bugün · ${label}`
  if (key === yesterdayKey) return `Dün · ${label}`
  if (year !== new Date().getFullYear()) return `${day} ${MONTHS[month - 1]} ${year}`
  return label
}

export function absoluteDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `2 saat önce`, `3 gün önce` — detay panelindeki ikincil zaman. */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 1) return 'az önce'
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)} dk ${minutes > 0 ? 'önce' : 'sonra'}`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return `${Math.abs(hours)} saat ${hours > 0 ? 'önce' : 'sonra'}`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${Math.abs(days)} gün ${days > 0 ? 'önce' : 'sonra'}`
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return `${Math.abs(months)} ay ${months > 0 ? 'önce' : 'sonra'}`
  return `${Math.abs(Math.round(months / 12))} yıl ${months > 0 ? 'önce' : 'sonra'}`
}

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  medium: 'bg-sev-medium',
  low: 'bg-sev-low',
  info: 'bg-sev-info',
}

/**
 * Liste satırının sol oluğu. Nokta yerine sürekli şerit: göz dikey tararken
 * rengin kesintisiz olması, tek tek noktaları okumaktan hızlı.
 */
export const SEVERITY_RAIL: Record<Severity, string> = {
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  medium: 'bg-sev-medium/80',
  low: 'bg-sev-low/60',
  info: 'bg-sev-info/40',
}

export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-sev-critical',
  high: 'text-sev-high',
  medium: 'text-sev-medium',
  low: 'text-sev-low',
  info: 'text-sev-info',
}

export const STATUS_TONE: Record<EntryStatus, string> = {
  open: 'text-sev-critical border-sev-critical/30 bg-sev-critical/10',
  'in-progress': 'text-info border-info/30 bg-info/10',
  blocked: 'text-sev-critical border-sev-critical/30 bg-sev-critical/10',
  verified: 'text-info border-info/30 bg-info/10',
  monitoring: 'text-warning border-warning/30 bg-warning/10',
  fixed: 'text-success border-success/30 bg-success/10',
  done: 'text-success border-success/30 bg-success/10',
  wontfix: 'text-muted-foreground border-border bg-surface-2',
}

/** `YYYY-MM-DD` biçiminde bugünden N gün önce. Tarih aralığı çipleri için. */
export function daysAgoKey(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localDayKey(date.toISOString())
}

export function todayKey(): string {
  return localDayKey(new Date().toISOString())
}
