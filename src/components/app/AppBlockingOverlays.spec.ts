import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppBlockingOverlays from "./AppBlockingOverlays.vue";
import { SUPPORT_MESSENGER_OPEN_EVENT } from "../../services/supportMessengerEvent";

const baseProps = {
  killSwitchVisible: false,
  killSwitchMessage: "The service is unavailable. Please see the status page for updates.",
  brandLogoUrl: "",
  theme: "light" as const,
  maintenanceVisible: false,
  maintenanceMessage: "Maintenance is in progress. Please see the status page for more information.",
  versionVisible: false,
  currentVersion: "n/a",
  latestVersion: null,
  sessionVisible: false,
  sessionTitle: "Session ended",
  sessionMessage: "Please sign in again.",
};

describe("AppBlockingOverlays", () => {
  it("renders killswitch downtime with the shared actions and opens Intercom", async () => {
    const wrapper = mount(AppBlockingOverlays, {
      props: { ...baseProps, killSwitchVisible: true },
    });
    const openIntercom = vi.fn();
    window.addEventListener(SUPPORT_MESSENGER_OPEN_EVENT, openIntercom);

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    expect(wrapper.find("h1").text()).toBe("We’ll be back soon");
    expect(wrapper.findAll("p").map((paragraph) => paragraph.text())).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Email support");
    expect(wrapper.find(".downtime-screen-status-link").text()).toBe("status page");
    expect(wrapper.find(".downtime-screen-status-link").attributes("href")).toBe(
      "https://status.itemtraxx.com",
    );
    expect(wrapper.find(".downtime-screen-action-primary").attributes("href")).toBe(
      "https://status.itemtraxx.com",
    );

    expect(wrapper.findAll(".downtime-screen-action").map((action) => action.text())).toEqual([
      "View Live Status",
      "Open Support Chat",
      "Refresh",
    ]);
    await wrapper.find(".downtime-screen-action-support").trigger("click");
    expect(openIntercom).toHaveBeenCalledOnce();
    window.removeEventListener(SUPPORT_MESSENGER_OPEN_EVENT, openIntercom);
  });

  it("renders maintenance message status-page text as a clickable link", () => {
    const wrapper = mount(AppBlockingOverlays, {
      props: { ...baseProps, maintenanceVisible: true },
    });

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    expect(wrapper.find("h1").text()).toBe("We’ll be back soon");
    expect(wrapper.findAll("p").map((paragraph) => paragraph.text())).toHaveLength(1);
    expect(wrapper.find(".downtime-screen-status-link").text()).toBe("status page");
    expect(wrapper.find(".downtime-screen-status-link").attributes("href")).toBe(
      "https://status.itemtraxx.com",
    );
    expect(wrapper.findAll(".downtime-screen-action").map((action) => action.text())).toEqual([
      "View Live Status",
      "Open Support Chat",
      "Refresh",
    ]);
  });
});
