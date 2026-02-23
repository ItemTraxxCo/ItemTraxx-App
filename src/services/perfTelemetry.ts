type PerfMetric = {
  name: string;
  valueMs: number;
  route?: string;
};

const ROUTE_NAV_START_KEY = "itx-route-nav-start";
const MAX_METRICS_BUFFER = 50;
const metricsBuffer: PerfMetric[] = [];

const pushMetric = (metric: PerfMetric) => {
  metricsBuffer.push(metric);
  if (metricsBuffer.length > MAX_METRICS_BUFFER) {
    metricsBuffer.shift();
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[perf] ${metric.name}: ${metric.valueMs.toFixed(1)}ms`, metric.route ?? "");
  }
};

export const markRouteNavigationStart = () => {
  performance.mark(ROUTE_NAV_START_KEY);
};

export const markRouteNavigationEnd = (routePath: string) => {
  const endMark = `${ROUTE_NAV_START_KEY}-end`;
  performance.mark(endMark);
  try {
    const measure = performance.measure("route-nav", ROUTE_NAV_START_KEY, endMark);
    pushMetric({ name: "route-nav", valueMs: measure.duration, route: routePath });
  } catch {
    // ignore missing marks
  } finally {
    performance.clearMarks(ROUTE_NAV_START_KEY);
    performance.clearMarks(endMark);
    performance.clearMeasures("route-nav");
  }
};

export const captureInitialPerfMetrics = () => {
  const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navEntry) {
    pushMetric({ name: "dom-content-loaded", valueMs: navEntry.domContentLoadedEventEnd });
    pushMetric({ name: "load-event", valueMs: navEntry.loadEventEnd });
    pushMetric({ name: "ttfb", valueMs: navEntry.responseStart });
  }

  const fcpEntry = performance
    .getEntriesByType("paint")
    .find((entry) => entry.name === "first-contentful-paint");
  if (fcpEntry) {
    pushMetric({ name: "first-contentful-paint", valueMs: fcpEntry.startTime });
  }
};

export const getPerfMetricsSnapshot = () => [...metricsBuffer];
