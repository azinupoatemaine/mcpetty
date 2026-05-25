export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Disable TLS cert validation globally at startup.
    // Self-signed certs are standard in homelab Proxmox / private services.
    // Setting this once here avoids the race condition caused by toggling the
    // env var per-request in an async event loop.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    const { ensureDefaultUser }     = await import('./lib/auth')
    const { bootAll }               = await import('./lib/process-manager')
    const { startHealthScheduler }  = await import('./lib/health-scheduler')
    ensureDefaultUser()
    bootAll()
    startHealthScheduler()
  }
}
