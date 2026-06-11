const DEVICE_ID_KEY = "itemtraxx-device-id";
const DEVICE_LABEL_KEY = "itemtraxx-device-label";

const createDeviceId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `itx-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Secure random device identifiers are unavailable.");
};

const detectDeviceLabel = () => {
  const ua = navigator.userAgent || "";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown device";
};

export const getOrCreateDeviceSession = () => {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY) ?? "";
  if (!deviceId) {
    deviceId = createDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  let deviceLabel = localStorage.getItem(DEVICE_LABEL_KEY) ?? "";
  if (!deviceLabel) {
    deviceLabel = detectDeviceLabel();
    localStorage.setItem(DEVICE_LABEL_KEY, deviceLabel);
  }

  return { deviceId, deviceLabel };
};

export const rotateDeviceSession = () => {
  const deviceId = createDeviceId();
  const deviceLabel = detectDeviceLabel();
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  localStorage.setItem(DEVICE_LABEL_KEY, deviceLabel);
  return { deviceId, deviceLabel };
};
