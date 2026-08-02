import { describe, expect, it } from "vitest";
import { finishRouteLoading, getRouteLoadingState, startRouteLoading } from "./routeLoading";

describe("routeLoading store", () => {
  it("toggles isLoading via start/finish", () => {
    expect(getRouteLoadingState().isLoading).toBe(false);
    startRouteLoading();
    expect(getRouteLoadingState().isLoading).toBe(true);
    finishRouteLoading();
    expect(getRouteLoadingState().isLoading).toBe(false);
  });
});
