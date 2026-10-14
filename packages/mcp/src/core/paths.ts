// Dotted-path get/set on plain objects.

export const getPath = (obj: any, path: string) => path.split(".").reduce((o, k) => o?.[k], obj);

export function setPath(obj: Record<string, any>, path: string, value: unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}
