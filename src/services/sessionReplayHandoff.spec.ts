import { afterEach, describe, expect, it } from "vitest";
import {
  clearReplaySessionHandoff,
  SESSION_REPLAY_HANDOFF_COOKIE_NAME,
} from "./sessionReplayHandoff";

afterEach(() => {
  clearReplaySessionHandoff();
});

describe("legacy replay handoff cleanup", () => {
  it("clears a handoff cookie left by an older build", () => {
    document.cookie = `${SESSION_REPLAY_HANDOFF_COOKIE_NAME}=legacy; Path=/`;
    expect(document.cookie).toContain(SESSION_REPLAY_HANDOFF_COOKIE_NAME);

    clearReplaySessionHandoff();

    expect(document.cookie).not.toContain(SESSION_REPLAY_HANDOFF_COOKIE_NAME);
  });
});
