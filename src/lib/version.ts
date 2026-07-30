// Single source of truth for "what am I running".
//
// The published image is always tagged :latest (main) or :<branch>, so the image tag can
// never tell you which commit is deployed. BUILD_SHA can. It is injected as a Docker build
// arg (see Dockerfile) and inlined by `next build`.
//
// These must be read as literal `process.env.NEXT_PUBLIC_*` property accesses — Next
// replaces those textually at build time and does NOT inline dynamic lookups, so
// process.env[someVariable] would silently yield undefined in the browser bundle.

export const APP_VERSION = '2.0.2'

export const BUILD_SHA  = process.env.NEXT_PUBLIC_BUILD_SHA  || ''
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || ''
export const BUILD_REF  = process.env.NEXT_PUBLIC_BUILD_REF  || ''

// Short label for the footer. A build with no injected SHA is a local `npm run dev` or a
// `docker build` without build args — say so rather than implying a released build.
export function buildLabel(): string {
  if (!BUILD_SHA) return `v${APP_VERSION} · dev`
  // Branch builds are the ones you have to be careful about, so name them. main is the
  // normal case and would just be noise.
  const ref = BUILD_REF && BUILD_REF !== 'main' ? ` · ${BUILD_REF}` : ''
  return `v${APP_VERSION} · ${BUILD_SHA}${ref}`
}

// Everything known about this build, for the footer's title attribute — hover to get the
// full detail without spending footer width on it.
export function buildDetail(): string {
  if (!BUILD_SHA) return 'Local development build — no commit metadata baked in.'
  const parts = [`commit ${BUILD_SHA}`]
  if (BUILD_REF)  parts.push(`branch ${BUILD_REF}`)
  if (BUILD_TIME) parts.push(`built ${BUILD_TIME}`)
  return parts.join(' · ')
}
