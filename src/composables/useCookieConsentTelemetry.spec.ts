import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { useCookieConsentTelemetry } from "./useCookieConsentTelemetry";

vi.mock("../services/cookieConsentService", () => ({
  allowsAnalytics: vi.fn(),
  clearAnalyticsPersistence: vi.fn(),
  hasCookieConsent: vi.fn(),
  readCookieConsent: vi.fn(),
  subscribeCookieConsent: vi.fn(),
  writeCookieConsent: vi.fn(),
}));
vi.mock("../services/consentRecordService", () => ({
  recordCookieConsent: vi.fn().mockResolvedValue(undefined),
}));

import {
  allowsAnalytics,
  clearAnalyticsPersistence,
  hasCookieConsent,
  readCookieConsent,
  subscribeCookieConsent,
  writeCookieConsent,
  type CookieConsentState,
} from "../services/cookieConsentService";
import { recordCookieConsent } from "../services/consentRecordService";

const mockedAllowsAnalytics = vi.mocked(allowsAnalytics);
const mockedClearAnalyticsPersistence = vi.mocked(clearAnalyticsPersistence);
const mockedHasCookieConsent = vi.mocked(hasCookieConsent);
const mockedReadCookieConsent = vi.mocked(readCookieConsent);
const mockedSubscribeCookieConsent = vi.mocked(subscribeCookieConsent);
const mockedWriteCookieConsent = vi.mocked(writeCookieConsent);
const mockedRecordCookieConsent = vi.mocked(recordCookieConsent);

const consentState: CookieConsentState = {
  version: 2,
  preferences: { analytics: true, diagnostics: true },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let consentListener: ((state: CookieConsentState | null) => void) | null = null;

const mountHost = (role: string | null = null) => {
  const auth = reactive({ role });
  let exposed!: ReturnType<typeof useCookieConsentTelemetry>;
  const Host = defineComponent({
    setup() {
      exposed = useCookieConsentTelemetry(auth);
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed, auth };
};

describe("useCookieConsentTelemetry", () => {
  beforeEach(() => {
    mockedAllowsAnalytics.mockReset().mockReturnValue(false);
    mockedClearAnalyticsPersistence.mockReset();
    mockedHasCookieConsent.mockReset().mockReturnValue(false);
    mockedReadCookieConsent.mockReset().mockReturnValue(null);
    mockedSubscribeCookieConsent.mockReset().mockImplementation((listener) => {
      consentListener = listener;
      return vi.fn();
    });
    mockedWriteCookieConsent.mockReset();
    mockedRecordCookieConsent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    consentListener = null;
  });

  it("syncs consent state on mount and shows the banner when there is no stored consent", () => {
    mockedReadCookieConsent.mockReturnValue(null);
    mockedHasCookieConsent.mockReturnValue(false);
    const { wrapper, get } = mountHost();

    expect(get().cookieConsent.value).toBeNull();
    expect(get().showCookieConsentBanner.value).toBe(true);
    wrapper.unmount();
  });

  it("hides the banner and enables telemetry once consent allows analytics", () => {
    mockedReadCookieConsent.mockReturnValue(consentState);
    mockedHasCookieConsent.mockReturnValue(true);
    mockedAllowsAnalytics.mockReturnValue(true);
    const { wrapper, get } = mountHost();

    expect(get().showCookieConsentBanner.value).toBe(false);
    expect(get().showTelemetry.value).toBe(true);
    expect(mockedClearAnalyticsPersistence).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("clears analytics persistence when consent does not allow analytics", () => {
    mockedReadCookieConsent.mockReturnValue({
      ...consentState,
      preferences: { analytics: false, diagnostics: true },
    });
    mockedHasCookieConsent.mockReturnValue(true);
    mockedAllowsAnalytics.mockReturnValue(false);
    const { wrapper, get } = mountHost();

    expect(get().showTelemetry.value).toBe(false);
    expect(mockedClearAnalyticsPersistence).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("acceptEssentialOnly writes analytics/diagnostics-off preferences and re-syncs", () => {
    const { wrapper, get } = mountHost();
    mockedReadCookieConsent.mockReturnValue({
      ...consentState,
      preferences: { analytics: false, diagnostics: false },
    });

    get().acceptEssentialOnly();

    expect(mockedWriteCookieConsent).toHaveBeenCalledWith({ analytics: false, diagnostics: false });
    expect(mockedReadCookieConsent).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("acceptAll writes both preferences on", () => {
    const { wrapper, get } = mountHost();

    get().acceptAll();

    expect(mockedWriteCookieConsent).toHaveBeenCalledWith({ analytics: true, diagnostics: true });
    wrapper.unmount();
  });

  it("mirrors the saved consent to the audit service via dynamic import after saving", async () => {
    mockedReadCookieConsent.mockReturnValue(consentState);
    const { wrapper, get } = mountHost();

    get().acceptAll();
    await vi.waitFor(() => expect(mockedRecordCookieConsent).toHaveBeenCalledWith(
      consentState.preferences,
      consentState.updatedAt,
    ));
    wrapper.unmount();
  });

  it("does not call the audit mirror if there is no local consent state yet", async () => {
    mockedReadCookieConsent.mockReturnValue(null);
    const { wrapper, auth } = mountHost();

    auth.role = "workspace_admin";
    await Promise.resolve();

    expect(mockedRecordCookieConsent).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("re-mirrors consent when auth.role changes and consent already exists", async () => {
    mockedReadCookieConsent.mockReturnValue(consentState);
    const { wrapper, auth } = mountHost();
    await vi.waitFor(() => expect(mockedRecordCookieConsent).not.toHaveBeenCalled());

    auth.role = "workspace_admin";
    await vi.waitFor(() => expect(mockedRecordCookieConsent).toHaveBeenCalledTimes(1));
    wrapper.unmount();
  });

  it("re-syncs when the consent subscription observes a change", () => {
    const { wrapper, get } = mountHost();
    expect(get().cookieConsent.value).toBeNull();

    consentListener?.(consentState);

    expect(get().cookieConsent.value).toEqual(consentState);
    wrapper.unmount();
  });

  it("removes its consent subscription on unmount", () => {
    const unsubscribe = vi.fn();
    mockedSubscribeCookieConsent.mockReturnValue(unsubscribe);
    const { wrapper } = mountHost();

    wrapper.unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
