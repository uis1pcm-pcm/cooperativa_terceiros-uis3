type CounterStore = {
  counters: Map<string, number>;
};

const GLOBAL_KEY = "__cooperativaTelemetry";

function getStore(): CounterStore {
  const globalObject = globalThis as typeof globalThis & { [GLOBAL_KEY]?: CounterStore };
  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = {
      counters: new Map<string, number>(),
    };
  }
  return globalObject[GLOBAL_KEY]!;
}

function sanitisePayload(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined;
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, value] as const);
  return Object.fromEntries(entries);
}

export function recordTelemetry(event: string, payload?: Record<string, unknown>): void {
  if (!event) return;
  const store = getStore();
  const current = store.counters.get(event) ?? 0;
  store.counters.set(event, current + 1);

  if (process.env.NODE_ENV !== "production") {
    const infoPayload = sanitisePayload({
      count: store.counters.get(event),
      ...payload,
    });
    // eslint-disable-next-line no-console -- Telemetry logging for observability during development/test runs.
    console.info(`[telemetry] ${event}`, infoPayload ?? {});
  }
}

export function getTelemetryCounters(): Record<string, number> {
  const store = getStore();
  return Object.fromEntries(store.counters.entries());
}

export function resetTelemetry(): void {
  const store = getStore();
  store.counters.clear();
}

