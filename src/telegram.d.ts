declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string
        initDataUnsafe: {
          user?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
            photo_url?: string
            language_code?: string
          }
          start_param?: string
          auth_date?: number
          hash?: string
        }
        ready: () => void
        expand: () => void
        close: () => void
        themeParams: Record<string, string>
        colorScheme: 'light' | 'dark'
        viewportStableHeight: number
        viewportHeight: number
        setHeaderColor: (color: string) => void
        setBackgroundColor: (color: string) => void
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void
          selectionChanged: () => void
        }
        showAlert?: (message: string, cb?: () => void) => void
        showConfirm?: (message: string, cb?: (ok: boolean) => void) => void
        openTelegramLink: (url: string) => void
        openLink: (url: string) => void
        shareMessage?: (msgId: string, cb?: (success: boolean) => void) => void
        shareToStory?: (url: string, params?: unknown) => void
      }
    }
  }
}

export {}
