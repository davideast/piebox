/**
 * Capability-resource helper.
 *
 * Exposes a sandbox's `RuntimeCapabilities` as an MCP resource at
 * `piebox://sandbox/capabilities`. Why a resource and not embedded in
 * each tool description:
 *
 *   - MCP clients template tool descriptions into model prompts on
 *     every turn. Embedding the full capability blob (binaries list,
 *     persistence, etc.) into every tool's description bloats the
 *     prompt and duplicates data across N tools.
 *   - A resource is read once by the host (e.g. Claude Desktop reads
 *     resources on session start) and made available separately. The
 *     host decides when to splice it into context.
 *   - It also separates "what tools exist" (changes when the toolset
 *     changes) from "what the sandbox can do" (changes when the
 *     runtime changes). Different cache lifetimes.
 */

import type { RuntimeCapabilities } from "piebox/layer2";

export const CAPABILITIES_URI = "piebox://sandbox/capabilities";
export const CAPABILITIES_NAME = "Sandbox capabilities";
export const CAPABILITIES_DESCRIPTION =
  "Static description of what this piebox sandbox runtime can do — filesystem kind, process model, available binaries, persistence, and feature flags. Read once per session.";
export const CAPABILITIES_MIME_TYPE = "application/json";

/**
 * Render a capabilities object as the JSON-string payload an MCP
 * `resources/read` response carries. `RuntimeCapabilities` is already
 * plain data by design (no functions, no symbols) but
 * `availableBinaries` is a `readonly string[]` so we copy it to a
 * plain array for a clean serialization round-trip.
 */
export function renderCapabilitiesPayload(
  capabilities: RuntimeCapabilities,
): string {
  return JSON.stringify(
    {
      fileSystem: capabilities.fileSystem,
      processModel: capabilities.processModel,
      realNetwork: capabilities.realNetwork,
      nativeAddons: capabilities.nativeAddons,
      availableBinaries: [...capabilities.availableBinaries],
      interactiveTty: capabilities.interactiveTty,
      persistence: capabilities.persistence,
    },
    null,
    2,
  );
}

export interface CapabilitiesResourceRead {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

export function buildCapabilitiesResource(
  capabilities: RuntimeCapabilities,
): CapabilitiesResourceRead {
  return {
    contents: [
      {
        uri: CAPABILITIES_URI,
        mimeType: CAPABILITIES_MIME_TYPE,
        text: renderCapabilitiesPayload(capabilities),
      },
    ],
  };
}
