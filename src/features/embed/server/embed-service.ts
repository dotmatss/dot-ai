import "server-only";

import { and, eq } from "drizzle-orm";

import { getServerEnv } from "@/config/env";
import { findChatbotByEmbedKey } from "@/features/chatbots/server/chatbot-repository";
import type { Chatbot, ChatbotAppearance } from "@/features/chatbots/types";
import { isOriginAllowed, originFromReferer } from "@/features/embed/server/domain-match";
import { mintEmbedToken } from "@/features/embed/server/embed-token";
import { canEdit } from "@/features/workspaces/roles";
import { getAuthContext } from "@/server/auth/dal";
import { withDb } from "@/server/db/client";
import { organizationMembers, workspaces } from "@/server/db/schema";

/** The subset of chatbot configuration that is safe to send to visitors. */
export interface PublicChatbotConfig {
  embedKey: string;
  name: string;
  welcomeMessage: string;
  appearance: ChatbotAppearance;
}

export type EmbedResolution =
  | { kind: "ready"; config: PublicChatbotConfig; token: string; preview: boolean }
  | { kind: "not_found" }
  | { kind: "inactive" }
  | { kind: "origin_not_allowed"; origin: string | null };

export function toPublicConfig(chatbot: Chatbot): PublicChatbotConfig {
  return {
    embedKey: chatbot.embedKey,
    name: chatbot.name,
    welcomeMessage: chatbot.welcomeMessage,
    appearance: chatbot.appearance,
  };
}

/**
 * A preview token bypasses the status and allowed-domain checks, so it is an
 * editing capability rather than a reading one: it can run chat turns (and
 * spend model budget) against a chatbot that is not live. Viewers, who cannot
 * use the playground, must not get one either.
 */
async function canPreviewWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .select({ role: organizationMembers.role })
      .from(workspaces)
      .innerJoin(organizationMembers, eq(organizationMembers.organizationId, workspaces.organizationId))
      .where(and(eq(workspaces.id, workspaceId), eq(organizationMembers.userId, userId)))
      .limit(1),
  );
  return rows[0] ? canEdit(rows[0].role) : false;
}

/**
 * Decides whether the iframe page may serve a chatbot to the requesting parent
 * page. Members of the owning workspace get a preview token from the app
 * origin even when the chatbot is inactive or the domain list is empty.
 */
export async function resolveEmbed(embedKey: string, referer: string | null): Promise<EmbedResolution> {
  const chatbot = await findChatbotByEmbedKey(embedKey);
  if (!chatbot) return { kind: "not_found" };

  const origin = originFromReferer(referer);
  const appOrigin = new URL(getServerEnv().APP_URL).origin;

  if (origin === appOrigin) {
    const auth = await getAuthContext();
    if (auth && (await canPreviewWorkspace(auth.user.id, chatbot.workspaceId))) {
      return {
        kind: "ready",
        config: toPublicConfig(chatbot),
        token: mintEmbedToken({ embedKey, origin, preview: true }),
        preview: true,
      };
    }
  }

  if (chatbot.status !== "active") return { kind: "inactive" };
  if (!isOriginAllowed(origin, chatbot.allowedDomains)) return { kind: "origin_not_allowed", origin };

  return {
    kind: "ready",
    config: toPublicConfig(chatbot),
    token: mintEmbedToken({ embedKey, origin: origin!, preview: false }),
    preview: false,
  };
}
