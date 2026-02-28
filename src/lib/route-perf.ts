type Metric = {
  name: string;
  ms: number;
};

const ENABLED = process.env.PERF_TIMING_LOGS !== "0";

export function createRoutePerf(route: string) {
  const startedAt = performance.now();
  const metrics: Metric[] = [];

  return {
    async time<T>(name: string, fn: () => Promise<T>) {
      const started = performance.now();
      const result = await fn();
      metrics.push({ name, ms: performance.now() - started });
      return result;
    },
    flush(extra?: Record<string, string | number | boolean | null | undefined>) {
      if (!ENABLED) return;

      const totalMs = performance.now() - startedAt;
      const timingParts = metrics
        .map((item) => `${item.name}=${item.ms.toFixed(1)}ms`)
        .join(" ");
      const extraParts = Object.entries(extra ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");

      const message = [`[route-perf]`, `route=${route}`, `total=${totalMs.toFixed(1)}ms`, timingParts, extraParts]
        .filter(Boolean)
        .join(" ");
      console.info(message);
    },
  };
}

