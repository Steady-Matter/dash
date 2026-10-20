export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** The last usage reading: the context window and the plan's limit windows. */
export type Reading = {
  /** Tokens in the context now; null before the first response reports it. */
  ctxTokens: number | null
  ctxWindow: number
  /** Where Claude Code compacts the conversation: the auto-compact point, or the window; null when unknown. */
  ctxLimit: number | null
  limits: Limit[]
}

export type Cache = {
  /** When the main conversation's last request finished; 0 before the first. */
  lastRequestAt: number
  /** How long the cache lasts after a request: an hour, or five minutes when the requests say so. */
  ttlMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'dash': {
      reading: Reading | null
      cache: Cache
    }
  }
}
