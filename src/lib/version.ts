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

// next build sets NODE_ENV=production; `npm run dev` leaves it as development. Inlined the
// same way, so this distinguishes "running on a laptop" from "a real image was built".
const IS_PRODUCTION_BUILD = process.env.NODE_ENV === 'production'

// Short label for the footer. Missing metadata has two very different causes and they must
// not look alike — a local dev server is expected, a *built image* with no SHA means the
// build args never arrived and you cannot tell what you deployed.
export function buildLabel(): string {
  if (BUILD_SHA) {
    // Branch builds are the ones to be careful about, so name them. main is the normal case
    // and would just be noise.
    const ref = BUILD_REF && BUILD_REF !== 'main' ? ` · ${BUILD_REF}` : ''
    return `v${APP_VERSION} · ${BUILD_SHA}${ref}`
  }
  return IS_PRODUCTION_BUILD ? `v${APP_VERSION} · unidentified build` : `v${APP_VERSION} · dev`
}

// Everything known about this build, for the footer's title attribute — hover to get the
// full detail without spending footer width on it.
export function buildDetail(): string {
  if (!BUILD_SHA) {
    return IS_PRODUCTION_BUILD
      ? 'This image was built without commit metadata, so the running version cannot be identified. '
        + 'The CI job did not pass BUILD_SHA — note that a workflow_run-triggered job always uses the '
        + 'workflow file from the default branch, so changes to it only take effect once merged there.'
      : 'Local development build — no commit metadata baked in.'
  }
  const parts = [`commit ${BUILD_SHA}`]
  if (BUILD_REF)  parts.push(`branch ${BUILD_REF}`)
  if (BUILD_TIME) parts.push(`built ${BUILD_TIME}`)
  return parts.join(' · ')
}
