const DEVICE_ID_KEY = "itemtraxx-device-id";
const DEVICE_LABEL_KEY = "itemtraxx-device-label";

const createDeviceId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `itx-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
