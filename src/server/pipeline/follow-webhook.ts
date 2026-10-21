import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { LEGACY_HANDOFF_PERMIT_MS } from "@/lib/campaign-rate";
import { ingestGuardedMessages } from "@/server/campaigns/message-inbox";
import { followGates } from "@/server/db/schema";
import type { ParsedCampaignMessage } from "@/server/instagram/campaign-messaging";
import type { GraphClient } from "@/server/instagram/graph";
import type { FollowTap } from "@/server/instagram/webhook";
import { SendHandoffError } from "@/server/queue/send-errors";
import { handleFollowTap, type FollowTapOutcome } from "./follow-gate";
import type { PipelineDeps } from "./process-comment";

/** Preserve the never-enabled legacy behavior while fencing flag changes before every external write. */
export async function handleLegacyTapWithGuard(deps: PipelineDeps, tap: FollowTap, messages: ParsedCampaignMessage[]): Promise<FollowTapOutcome | "guarded"> {
  const forAccount = messages.filter((message) => message.igUserId === tap.igUserId);
  let checked = false; let invokedWrites = 0;
  async function refundUnsentCheck() {
    if (checked && invokedWrites === 0) {
      await deps.db.update(followGates).set({ checks: sql`greatest(0, ${followGates.checks} - 1)` }).where(eq(followGates.id, tap.gateId));
      checked = false;
    }
  }
  async function guard(write: boolean) {
    for (;;) {
      const started = performance.now();
      if (write) {
        // A conservative intent marker: activation must account for this call even if its response is lost.
        const [row] = await deps.db.update(followGates).set({ lastUntrackedSendAt: deps.now() }).where(eq(followGates.id, tap.gateId)).returning({ id: followGates.id });
        if (!row) throw new Error("follow_source_deleted");
      }
      const routed = await ingestGuardedMessages(deps.db, forAccount, deps.now(), [tap]);
      if (routed.guardedIgUserIds.has(tap.igUserId)) throw new SendHandoffError();
      if (performance.now() - started < LEGACY_HANDOFF_PERMIT_MS) return;
      // A stalled callback must refresh its mode/marker instead of invoking after a stale OFF observation.
    }
  }
  const initial = await ingestGuardedMessages(deps.db, forAccount, deps.now(), [tap]);
  if (initial.guardedIgUserIds.has(tap.igUserId)) return "guarded";
  const overrides: Pick<GraphClient, "isFollower" | "sendMessage"> = {
    isFollower: async (token, sender) => { checked = true; await guard(false); return deps.graph.isFollower(token, sender); },
    sendMessage: async (token, account, recipient, message) => { await guard(true); invokedWrites++; return deps.graph.sendMessage(token, account, recipient, message); },
  };
  const graph = new Proxy(deps.graph, { get(target, key) { if (key in overrides) return overrides[key as keyof typeof overrides]; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  try {
    const result = await handleFollowTap({ ...deps, graph }, tap);
    // A flag can also change during a failing profile read, before the old helper reaches a write.
    if (result === "failed" && invokedWrites === 0) {
      const late = await ingestGuardedMessages(deps.db, forAccount, deps.now(), [tap]);
      if (late.guardedIgUserIds.has(tap.igUserId)) { await refundUnsentCheck(); return "guarded"; }
    }
    return result;
  } catch (error) { if (error instanceof SendHandoffError) { await refundUnsentCheck(); return "guarded"; } throw error; }
}
