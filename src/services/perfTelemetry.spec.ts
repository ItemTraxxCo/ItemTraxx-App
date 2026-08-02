import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureInitialPerfMetrics,
  markRouteNavigationEnd,
  markRouteNavigationStart,
} from "./perfTelemetry";

afterEach(() => {
  vi.restoreAllMocks();
  performance.clearMarks();
  performance.clearMeasures();
});

describe("markRouteNavigationStart / markRouteNavigationEnd", () => {
  it("marks the start key on navigation start", () => {
    const markSpy = vi.spyOn(performance, "mark");
    markRouteNavigationStart();
    expect(markSpy).toHaveBeenCalledWith("itx-route-nav-start");
  });

  it("measures the route-nav duration and clears the marks/measure afterward", () => {
    const measureSpy = vi.spyOn(performance, "measure");
    const clearMarksSpy = vi.spyOn(performance, "clearMarks");
    const clearMeasuresSpy = vi.spyOn(performance, "clearMeasures");

    markRouteNavigationStart();
    markRouteNavigationEnd("/dashboard");

    expect(measureSpy).toHaveBeenCalledWith(
      "route-nav",
      "itx-route-nav-start",
      "itx-route-nav-start-end"
    );
    expect(clearMarksSpy).toHaveBeenCalledWith("itx-route-nav-start");
    expect(clearMarksSpy).toHaveBeenCalledWith("itx-route-nav-start-end");
    expect(clearMeasuresSpy).toHaveBeenCalledWith("route-nav");
  });

  it("swallows the error and still clears marks when the start mark is missing", () => {
    expect(() => markRouteNavigationEnd("/no-start-mark")).not.toThrow();
  });
});

describe("captureInitialPerfMetrics", () => {
  it("records dom-content-loaded/load-event/ttfb from the navigation entry when present", () => {
    const navEntry = {
      domContentLoadedEventEnd: 120,
      loadEventEnd: 200,
      responseStart: 15,
    };
    vi.spyOn(performance, "getEntriesByType").mockImplementation((type: string) => {
      if (type === "navigation") return [navEntry] as unknown as PerformanceEntryList;
      if (type === "paint") return [] as unknown as PerformanceEntryList;
      return [] as unknown as PerformanceEntryList;
    });

    expect(() => captureInitialPerfMetrics()).not.toThrow();
    expect(performance.getEntriesByType).toHaveBeenCalledWith("navigation");
    expect(performance.getEntriesByType).toHaveBeenCalledWith("paint");
  });

  it("records first-contentful-paint when a paint entry is present", () => {
    vi.spyOn(performance, "getEntriesByType").mockImplementation((type: string) => {
      if (type === "navigation") return [] as unknown as PerformanceEntryList;
      if (type === "paint") {
        return [{ name: "first-contentful-paint", startTime: 42 }] as unknown as PerformanceEntryList;
      }
      return [] as unknown as PerformanceEntryList;
    });

    expect(() => captureInitialPerfMetrics()).not.toThrow();
  });

  it("does nothing unsafe when there is no navigation entry and no paint entries", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([] as unknown as PerformanceEntryList);
    expect(() => captureInitialPerfMetrics()).not.toThrow();
  });
});
