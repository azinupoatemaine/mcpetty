import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession, SESSION_COOKIE } from '../../lib/auth'
import AuditClient from '../audit-client'

export default async function AuditPage() {
  const jar   = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token || !validateSession(token)) redirect('/login')
  return <AuditClient />
}
