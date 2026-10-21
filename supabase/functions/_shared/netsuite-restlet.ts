// Inbound shipment RESTlet addressing (Phase 1, W3c).
//
// RESTlets live on a different host from /services/rest/. The numeric script
// and deploy ids differ between sandbox and production, but the RESTlet URL
// accepts the text ids in their place, so storing those means only the host
// changes between environments. The host comes from the account id.

export const DEFAULT_RESTLET_SCRIPT_ID = 'customscript_spx_ww_inb_receipt_rl'
export const DEFAULT_RESTLET_DEPLOY_ID = 'customdeploy_spx_ww_inb_receipt_rl'

export type RestletTarget = { scriptId: string; deployId: string }

// NetSuite script and deploy ids: letters, digits and underscores, or the
// numeric internal id. Anything else would let a caller alter the query string.
const RESTLET_ID = /^[A-Za-z0-9_]{1,100}$/

export function restletHost(accountId: string): string {
  return `${accountId.trim().toLowerCase().replace(/_/g, '-')}.restlets.api.netsuite.com`
}

export function isValidRestletId(value: unknown): value is string {
  return typeof value === 'string' && RESTLET_ID.test(value)
}

/** The stored override if it is well formed, else the text ids agreed with the NetSuite developer. */
export function resolveRestletTarget(config: Record<string, unknown> | null | undefined): RestletTarget {
  const script = config?.restlet_script_id
  const deploy = config?.restlet_deploy_id
  return {
    scriptId: isValidRestletId(script) ? script : DEFAULT_RESTLET_SCRIPT_ID,
    deployId: isValidRestletId(deploy) ? deploy : DEFAULT_RESTLET_DEPLOY_ID,
  }
}

export function buildRestletUrl(
  accountId: string,
  target: RestletTarget,
  params: Record<string, string> = {},
): string {
  const query = new URLSearchParams({ script: target.scriptId, deploy: target.deployId, ...params })
  return `https://${restletHost(accountId)}/app/site/hosting/restlet.nl?${query.toString()}`
}
