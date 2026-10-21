import { describe, expect, it } from "vitest";
import { CAMPAIGN_STATES, campaignKstInput, campaignUtcFromKst } from "@/lib/campaign-schema";
import { canTransitionCampaign, dueCampaignTransitions, isActiveCampaign } from "@/server/campaigns/state";

describe("campaign state and time", () => {
  it("allows only the forward product transitions", () => {
    const edges = new Set(["draft:teaser", "draft:open", "teaser:open", "open:closed", "open:sold_out", "closed:settled", "sold_out:settled"]);
    for (const from of CAMPAIGN_STATES) for (const to of CAMPAIGN_STATES) expect(canTransitionCampaign(from, to), `${from}:${to}`).toBe(edges.has(`${from}:${to}`));
  });
  it("never auto-opens unpublished drafts and catches up both boundaries after a restart", () => {
    const times = { openAt: new Date("2026-10-21T00:00:00Z"), closeAt: new Date("2026-10-21T01:00:00Z") };
    expect(dueCampaignTransitions({ status: "draft", publishedAt: null, ...times }, times.closeAt)).toEqual([]);
    expect(dueCampaignTransitions({ status: "teaser", publishedAt: times.openAt, ...times }, times.closeAt)).toEqual(["open", "closed"]);
    expect(dueCampaignTransitions({ status: "sold_out", publishedAt: times.openAt, ...times }, times.closeAt)).toEqual([]);
    expect(dueCampaignTransitions({ status: "draft", publishedAt: times.openAt, ...times }, new Date(times.openAt.getTime() - 1))).toEqual([]);
  });
  it("counts published future campaigns as active but not ordinary drafts", () => {
    expect(isActiveCampaign({ status: "draft", publishedAt: null })).toBe(false);
    expect(isActiveCampaign({ status: "draft", publishedAt: new Date() })).toBe(true);
    expect(isActiveCampaign({ status: "closed", publishedAt: new Date() })).toBe(false);
  });
  it("converts Seoul midnight to the preceding UTC date independently of local TZ", () => {
    expect(campaignUtcFromKst("2026-10-21T00:00")).toBe("2026-10-20T15:00:00.000Z");
    expect(campaignKstInput(new Date("2026-10-20T15:00:00Z"))).toBe("2026-10-21T00:00");
    expect(() => campaignUtcFromKst("2026-02-30T12:00")).toThrow();
    expect(() => campaignUtcFromKst("invalid")).toThrow();
  });
});
