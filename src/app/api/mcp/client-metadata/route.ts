import { clientMetadataDocument } from "@/features/mcp/server/mcp-oauth";

/**
 * Our OAuth Client ID Metadata Document.
 *
 * Revision 2026-07-28 deprecates Dynamic Client Registration in favour of
 * this: the URL of this document *is* our `client_id`, and an authorization
 * server fetches it to learn who is asking.
 *
 * Public and unauthenticated by necessity — the fetcher is an authorization
 * server, not a signed-in browser. It contains no secret and must not: it
 * describes a public client, and `token_endpoint_auth_method: "none"` is the
 * honest statement that we hold no client secret at all.
 */
export async function GET(): Promise<Response> {
  return new Response(JSON.stringify(clientMetadataDocument()), {
    headers: {
      "Content-Type": "application/json",
      // Authorization servers may cache this. Short enough that a deployment
      // at a new URL is picked up without a stale redirect_uri lingering.
      "Cache-Control": "public, max-age=300",
    },
  });
}
