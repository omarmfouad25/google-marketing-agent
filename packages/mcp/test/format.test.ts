import { describe, expect, it } from "vitest";
import { formatRow, toMarkdownTable } from "../src/core/format.js";

describe("enum names", () => {
  it("maps known enum fields by path and keeps unknown numbers", () => {
    const r = formatRow({
      campaign: { status: 3, advertising_channel_type: 2, bidding_strategy_type: 10, geo_target_type_setting: { positive_geo_target_type: 7 } },
      ad_group_ad: { status: 2, policy_summary: { approval_status: 3 }, ad_strength: 7 },
      ad_group_criterion: { keyword: { match_type: 4 }, quality_info: { creative_quality_score: 2 } },
      segments: { device: 2 },
      metrics: { clicks: 3 },
    }) as any;
    expect(r.campaign.status).toBe("PAUSED");
    expect(r.campaign.advertising_channel_type).toBe("SEARCH");
    expect(r.campaign.bidding_strategy_type).toBe("MAXIMIZE_CONVERSIONS");
    expect(r.campaign.geo_target_type_setting.positive_geo_target_type).toBe("PRESENCE");
    expect(r.ad_group_ad.status).toBe("ENABLED");
    expect(r.ad_group_ad.policy_summary.approval_status).toBe("APPROVED_LIMITED");
    expect(r.ad_group_ad.ad_strength).toBe("EXCELLENT");
    expect(r.ad_group_criterion.keyword.match_type).toBe("BROAD");
    expect(typeof r.ad_group_criterion.quality_info.creative_quality_score).toBe("string");
    expect(typeof r.segments.device).toBe("string");
    expect(r.metrics.clicks).toBe(3);
  });

  it("maps goal, criterion and asset enums, and enum arrays element by element", () => {
    const r = formatRow({
      campaign: { primary_status_reasons: [11, 16] },
      campaign_conversion_goal: { category: 2, origin: 2 },
      conversion_goal_campaign_config: { goal_config_level: 3 },
      campaign_criterion: { type: 20 },
      campaign_asset: { field_type: 21 },
      user_list: { type: 5 },
      conversion_action: { counting_type: 3 },
    }) as any;
    expect(typeof r.user_list.type).toBe("string");
    expect(typeof r.conversion_action.counting_type).toBe("string");
    expect(r.campaign.primary_status_reasons.every((x: unknown) => typeof x === "string")).toBe(true);
    expect(r.conversion_goal_campaign_config.goal_config_level).toBe("CAMPAIGN");
    expect(r.campaign_conversion_goal.origin).toBe("WEBSITE");
    expect(r.campaign_criterion.type).toBe("LANGUAGE");
    expect(r.campaign_asset.field_type).toBe("LOGO");
  });
});

describe("markdown cells", () => {
  it("keeps IDs copyable, prints objects as JSON and escapes pipes", () => {
    const t = toMarkdownTable([{ ad: { id: 642263731332 }, user_location_view: { country_criterion_id: 2512 }, metrics: { clicks: 12345 }, policy: [{ topic: "X" }], name: "A | B" }]);
    expect(t).toContain("| 642263731332 |");
    expect(t).toContain("| 2512 |");
    expect(t).toContain("12,345");
    expect(t).toContain('[{"topic":"X"}]');
    expect(t).toContain("A \\| B");
    expect(t).not.toContain("[object Object]");
  });
});
