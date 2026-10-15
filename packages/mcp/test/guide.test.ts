import { describe, it, expect } from "vitest";
import { listTopics, getTopic } from "../src/core/guide.js";

describe("guide", () => {
  it("ships the seven topics", () => {
    expect(listTopics()).toEqual(["access", "benchmarks", "demand-gen", "gotchas", "gtm", "measurement", "policy"]);
  });

  it("returns a topic and rejects unknown ones with the list", () => {
    expect(getTopic("gotchas")).toMatch(/^# Google Ads API gotchas/);
    expect(() => getTopic("nope")).toThrow(/Unknown topic "nope". Topics: access, benchmarks/);
  });

  it("gives every topic a title and a one-line summary on line 3", () => {
    for (const t of listTopics()) {
      const lines = getTopic(t).split("\n");
      expect(lines[0]).toMatch(/^# \S/);
      expect(lines[1]).toBe("");
      expect(lines[2].length).toBeGreaterThan(10);
    }
  });
});
