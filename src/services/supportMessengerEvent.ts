/**
 * Public pages do not load Intercom (and therefore set no Intercom cookies)
 * until a visitor asks for help. Any launcher can request the Messenger by
 * dispatching this window event. Kept in its own tiny module so the heavier
 * Intercom service can be loaded lazily.
 */
export const SUPPORT_MESSENGER_OPEN_EVENT = "itemtraxx:open-support";

export const requestSupportMessenger = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUPPORT_MESSENGER_OPEN_EVENT));
};
