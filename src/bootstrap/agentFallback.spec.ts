import { beforeEach, describe, expect, it } from "vitest";
import { markAgentFallbackMounted } from "./agentFallback";

describe("markAgentFallbackMounted", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.itemtraxxAppMounted;
    document.documentElement.dataset.itemtraxxFallbackState = "pending";
  });

  it("marks the bootstrap as mounted and settles the fallback state", () => {
    markAgentFallbackMounted();

    expect(document.documentElement.dataset.itemtraxxAppMounted).toBe("true");
    expect(document.documentElement.dataset.itemtraxxFallbackState).toBe("mounted");
  });
});
