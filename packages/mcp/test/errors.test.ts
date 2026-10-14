import { describe, it, expect } from "vitest";
import { formatError } from "../src/core/errors.js";

describe("formatError", () => {
  it("formats Google Ads failures with code, field path and policy", () => {
    const err = {
      errors: [
        {
          message: "Too few.",
          error_code: { collection_size_error: "TOO_FEW" },
          location: { field_path_elements: [{ field_name: "operations", index: 0 }, { field_name: "seed_user_list_ids" }] },
        },
        {
          message: "Policy finding",
          error_code: { policy_finding_error: 2 },
          details: { policy_violation_details: { key: { policy_name: "CLICKBAIT", violating_text: "You won't believe" }, is_exemptible: false } },
        },
      ],
    };
    const out = formatError(err);
    expect(out).toContain("Too few.");
    expect(out).toContain("TOO_FEW");
    expect(out).toContain("operations[0].seed_user_list_ids");
    expect(out).toContain('CLICKBAIT: "You won\'t believe"');
  });

  it("formats googleapis errors", () => {
    const err = { response: { data: { error: { message: "User does not have sufficient permissions" } } } };
    expect(formatError(err)).toBe("User does not have sufficient permissions");
  });

  it("formats Error and non-Error values without [object Object]", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError({ weird: true })).toBe('{"weird":true}');
    expect(formatError("plain")).toBe("plain");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatError(circular)).toBe("Unserialisable error");
    expect(formatError(undefined)).toBe("undefined");
  });

  it("returns message of duck-typed objects without stack or config", () => {
    expect(formatError({ message: "x", stack: "at foo", config: { headers: { authorization: "secret" } } })).toBe("x");
  });

  it("does not throw on malformed errors arrays", () => {
    expect(typeof formatError({ errors: "boom" })).toBe("string");
    expect(typeof formatError({ errors: [null] })).toBe("string");
    expect(() => formatError({ errors: [null, { message: "ok" }] })).not.toThrow();
  });

  it("never prints undefined for Ads entries missing message or policy parts", () => {
    const out = formatError({
      errors: [{ error_code: { x: "Y" } }, { location: { field_path_elements: [{ field_name: "a" }] } }],
    });
    expect(out).toContain("Unknown error");
    expect(out).not.toContain("undefined");
  });

  it("treats an entry with only policy details as an Ads entry", () => {
    const out = formatError({
      errors: [{ message: "Disapproved", details: { policy_violation_details: { key: { policy_name: "P" } } } }],
    });
    expect(out).toContain("Disapproved");
    expect(out).toContain("[P]");
  });

  it("formats OAuth string errors with description", () => {
    expect(formatError({ response: { data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } })).toBe(
      "invalid_grant: Token has been expired or revoked."
    );
    expect(formatError({ response: { data: { error: "invalid_grant" } } })).toBe("invalid_grant");
  });

  it("formats an Error subclass carrying errors[] without stack or [object Object]", () => {
    class GoogleAdsFailure extends Error {
      errors: unknown[];
      constructor() {
        super("Request contained an invalid argument.");
        this.errors = [{ message: "Too few.", error_code: { collection_size_error: "TOO_FEW" } }];
      }
    }
    const out = formatError(new GoogleAdsFailure());
    expect(out).toContain("Too few.");
    expect(out).toContain("TOO_FEW");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toMatch(/\bat .*\(.*\)|\n\s+at /);
  });
});
