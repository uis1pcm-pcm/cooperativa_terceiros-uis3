export function decodeRouteParam(value: string): string {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[decodeRouteParam] Failed to decode route parameter", value, error);
    }
    return value;
  }
}
