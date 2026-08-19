/**
 * Pure helpers for interpreting what page content tells us. Kept free of any
 * `electron` import so they can be exercised outside the Electron runtime.
 */

/**
 * `window.open` features string carrying explicit width/height is the classic
 * popup/OAuth shape; a bare `window.open(url)` is just a new tab.
 */
export function isSizedPopup(features: string): boolean {
  if (!features) return false
  return /\b(width|height|innerWidth|innerHeight)\s*=\s*\d+/i.test(features)
}

/**
 * Pulls an unread count out of a page title. Web apps advertise unreads as a
 * leading "(3)" or "[3]" (Gmail, Slack, Discord, WhatsApp) — occasionally with a
 * "+" suffix — or as a bare bullet when they only signal "something is new".
 */
export function parseUnreadFromTitle(title?: string | null): { count: number; dot: boolean } {
  const none = { count: 0, dot: false }
  if (!title) return none
  const t = title.trim()

  // 1-3 digits only: four-digit groups are almost always years ("(2024) Recap"),
  // and genuine counts above 99 render as "99+" anyway.
  const bracketed = /^[([](\d{1,3})\+?[)\]]/.exec(t)
  if (bracketed) {
    const count = Number(bracketed[1])
    // "(0)" means read; treat it as no badge rather than a zero badge.
    return count > 0 ? { count, dot: false } : none
  }

  if (/^[•●·*]/.test(t)) return { count: 0, dot: true }

  return none
}
