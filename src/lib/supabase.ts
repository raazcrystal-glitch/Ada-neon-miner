import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

export async function callEdgeFunction<T>(
  name: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T | null; error: string | null }> {
  const url = `${SUPABASE_URL}/functions/v1/${name}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  }

  const tgInitData = window.Telegram?.WebApp?.initData
  if (tgInitData) {
    headers['X-Telegram-Init-Data'] = tgInitData
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (!response.ok) {
      const errText = await response.text()
      let errMsg = `Request failed (${response.status})`
      try {
        const errJson = JSON.parse(errText)
        errMsg = errJson.error || errMsg
      } catch {
        if (errText) errMsg = errText
      }
      return { data: null, error: errMsg }
    }

    const data = await response.json()
    return { data: data as T, error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}
