export function getTelegramUser() {
  const tg = window.Telegram?.WebApp
  if (!tg) return null
  return tg.initDataUnsafe?.user ?? null
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData ?? ''
}

export function getStartParam(): string | null {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null
}

export function initTelegram() {
  const tg = window.Telegram?.WebApp
  if (!tg) return
  tg.ready()
  tg.expand()
  try {
    tg.setHeaderColor('#0a0e27')
    tg.setBackgroundColor('#0a0e27')
  } catch {
    // ignore
  }
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style)
}

export function hapticNotification(type: 'success' | 'error' | 'warning') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type)
}

export function openTelegramLink(url: string) {
  window.Telegram?.WebApp?.openTelegramLink(url)
}

export function openExternalLink(url: string) {
  window.Telegram?.WebApp?.openLink(url)
}

export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp
    if (tg?.showAlert) {
      tg.showAlert(message, () => resolve())
    } else {
      alert(message)
      resolve()
    }
  })
}

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tg = window.Telegram?.WebApp
    if (tg?.showConfirm) {
      tg.showConfirm(message, (ok) => resolve(ok))
    } else {
      resolve(confirm(message))
    }
  })
}
