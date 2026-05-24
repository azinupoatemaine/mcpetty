import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validateSession, SESSION_COOKIE } from '../../lib/auth'
import GatewaysClient from '../gateways-client'

export default async function GatewaysPage() {
  const jar   = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token || !validateSession(token)) redirect('/login')
  return <GatewaysClient />
}
