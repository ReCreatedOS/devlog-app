import { useMemo, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { dayHeading } from '../lib/format'

const WEEKS = 30
const DAY_LABELS = ['Pzt', '', 'Çar', '', 'Cum', '', 'Paz']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function keyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 0 → boş, 1..4 → artan yoğunluk. */
function intensity(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 1) return 4
  return Math.min(4, Math.ceil((count / max) * 4))
}

const TONES = [
  'bg-surface-1',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/65',
  'bg-primary/90',
] as const

interface CalendarHeatProps {
  days: Record<string, number>
  selectedDay?: string
  onSelectDay: (day: string) => void
}

/**
 * "O gün ne olmuştu" sorusunun görsel cevabı. Son ~7 ayı hafta sütunları
 * hâlinde çizer; bir güne tıklamak tarih filtresini o güne kilitler.
 */
export function CalendarHeat({ days, selectedDay, onSelectDay }: CalendarHeatProps): ReactNode {
  const { columns, max, monthMarks } = useMemo(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    // Pazartesi başlangıçlı haftaya hizala.
    const offsetToMonday = (today.getDay() + 6) % 7
    const lastMonday = new Date(today)
    lastMonday.setDate(today.getDate() - offsetToMonday)

    const cols: Array<Array<{ key: string; count: number; future: boolean }>> = []
    const marks: Array<{ index: number; label: string }> = []
    const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
    let seenMonth = -1
    let maxCount = 0

    for (let week = WEEKS - 1; week >= 0; week -= 1) {
      const columnStart = new Date(lastMonday)
      columnStart.setDate(lastMonday.getDate() - week * 7)
      const column: Array<{ key: string; count: number; future: boolean }> = []
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(columnStart)
        date.setDate(columnStart.getDate() + day)
        const key = keyOf(date)
        const count = days[key] ?? 0
        if (count > maxCount) maxCount = count
        column.push({ key, count, future: date > today })
      }
      const month = columnStart.getMonth()
      if (month !== seenMonth) {
        seenMonth = month
        marks.push({ index: cols.length, label: MONTHS[month] ?? '' })
      }
      cols.push(column)
    }
    return { columns: cols, max: maxCount, monthMarks: marks }
  }, [days])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <div className="mx-auto">
        <div className="mb-1 ml-7 flex gap-[3px]">
          {columns.map((_, index) => {
            const mark = monthMarks.find((m) => m.index === index)
            return (
              <div key={index} className="w-[13px] text-[10px] text-muted-foreground">
                {mark?.label ?? ''}
              </div>
            )
          })}
        </div>

        <div className="flex gap-[3px]">
          <div className="flex w-6 flex-col gap-[3px]">
            {DAY_LABELS.map((label, index) => (
              <div
                key={index}
                className="flex h-[13px] items-center text-[9px] text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>

          {columns.map((column, columnIndex) => (
            <div key={columnIndex} className="flex flex-col gap-[3px]">
              {column.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  disabled={cell.future}
                  onClick={() => onSelectDay(cell.key)}
                  title={`${dayHeading(cell.key)} · ${cell.count} kayıt`}
                  className={cn(
                    'h-[13px] w-[13px] rounded-[3px] transition-transform duration-150',
                    cell.future ? 'opacity-0' : TONES[intensity(cell.count, max)],
                    selectedDay === cell.key && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                    !cell.future && 'hover:scale-125',
                  )}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <span>az</span>
          {TONES.map((tone) => (
            <span key={tone} className={cn('h-[10px] w-[10px] rounded-[2px]', tone)} />
          ))}
          <span>çok</span>
        </div>
      </div>
    </div>
  )
}
