// Turn any Google client error into readable text (one place for every product).
// Never throws, never returns "[object Object]", never dumps a stack.

type AdsEntry = {
  message?: unknown;
  error_code?: unknown;
  location?: { field_path_elements?: { field_name?: string; index?: number }[] };
  details?: { policy_violation_details?: { key?: { policy_name?: string; violating_text?: string }; is_exemptible?: boolean } };
};

type Shape = {
  message?: unknown;
  errors?: unknown;
  response?: { data?: { error?: unknown; error_description?: unknown } };
};

const isObj = (x: unknown): x is AdsEntry => typeof x === "object" && x !== null;

function isAdsEntry(x: AdsEntry): boolean {
  return x.error_code !== undefined || x.location !== undefined || x.details?.policy_violation_details !== undefined;
}

function fieldPath(e: AdsEntry): string {
  const parts = e.location?.field_path_elements ?? [];
  return parts.map((p) => `${p.field_name}${p.index !== undefined ? `[${p.index}]` : ""}`).join(".");
}

function policyPart(e: AdsEntry): string {
  const pv = e.details?.policy_violation_details;
  if (!pv) return "";
  const text = pv.key?.violating_text;
  const head = [pv.key?.policy_name, text ? `"${text}"` : undefined].filter(Boolean).join(": ");
  const exempt = typeof pv.is_exemptible === "boolean" ? `, exemptible=${pv.is_exemptible}` : "";
  return head ? ` [${head}${exempt}]` : "";
}

function adsLine(e: AdsEntry): string {
  const message = typeof e.message === "string" ? e.message : "Unknown error";
  const code = e.error_code != null ? JSON.stringify(e.error_code) : "";
  const path = fieldPath(e);
  return ["- " + message + policyPart(e), code, path ? `at ${path}` : ""].filter(Boolean).join(" ");
}

function stringify(err: unknown): string {
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return "Unserialisable error"; // circular or otherwise unserialisable
  }
}

export function formatError(err: unknown): string {
  const e = (err ?? {}) as Shape;
  const errors = Array.isArray(e.errors) ? e.errors.filter(isObj) : [];

  if (errors.some(isAdsEntry)) return errors.map(adsLine).join("\n");

  const apiError = e.response?.data?.error;
  if (typeof apiError === "string") {
    const desc = e.response?.data?.error_description;
    return typeof desc === "string" && desc ? `${apiError}: ${desc}` : apiError;
  }
  if (typeof (apiError as { message?: unknown } | undefined)?.message === "string") {
    return (apiError as { message: string }).message;
  }

  if (errors.length) {
    return errors.map((x) => (typeof x.message === "string" ? x.message : "Unknown error")).join("; ");
  }

  // Covers Error instances, cross-realm Errors and duck-typed objects; stack and config are never read.
  if (typeof e.message === "string") return e.message;
  if (typeof err === "string") return err;
  return stringify(err);
}
