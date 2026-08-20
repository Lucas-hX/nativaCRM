const endpoint = process.env.OUTBOX_RUN_URL ?? 'http://127.0.0.1:3000/api/internal/outbox/run'
const token = process.env.SUPABASE_SERVICE_ROLE_KEY
const interval = Math.max(1000, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000))
if (!token) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')

let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

while (!stopping) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(70_000) })
    if (!response.ok) console.error(`[outbox-worker] batch failed status=${response.status}`)
  } catch (error) {
    console.error(`[outbox-worker] request failed type=${error instanceof Error ? error.name : 'unknown'}`)
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, interval))
}
