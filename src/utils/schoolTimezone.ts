const knownTimezoneAliases = new Map([
  ['asia karachi', 'Asia/Karachi'],
  ['asia/karachi', 'Asia/Karachi'],
  ['karachi', 'Asia/Karachi'],
])

export function normalizeSchoolTimezone(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const aliasKey = trimmed.toLowerCase().replace(/\s+/g, ' ')
  const candidate = knownTimezoneAliases.get(aliasKey) ?? trimmed

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0)
    return candidate
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

export function requireValidSchoolTimezone(value: string | null | undefined): string | null {
  const normalized = normalizeSchoolTimezone(value)
  if (value?.trim() && !normalized) {
    throw new Error(`"${value.trim()}" is not a valid IANA timezone identifier.`)
  }
  return normalized
}

export function effectiveSchoolTimezone(value: string | null | undefined): string {
  return normalizeSchoolTimezone(value) ?? 'UTC'
}

export function schoolDateKey(timeZone: string | null | undefined, date = new Date()): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: effectiveSchoolTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(safeDate)
  const valueFor = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value
  const year = valueFor('year')
  const month = valueFor('month')
  const day = valueFor('day')
  if (!year || !month || !day) throw new Error('The school date could not be formatted.')
  return `${year}-${month}-${day}`
}

export function schoolMonthKey(timeZone: string | null | undefined, date = new Date()): string {
  return schoolDateKey(timeZone, date).slice(0, 7)
}

export function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) throw new Error(`"${dateKey}" is not a valid calendar date.`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatInSchoolTimezone(
  date: Date,
  timeZone: string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: effectiveSchoolTimezone(timeZone),
  }).format(date)
}
