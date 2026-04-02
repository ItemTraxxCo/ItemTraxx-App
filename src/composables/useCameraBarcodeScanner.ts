import { computed, onUnmounted, ref } from "vue";
import type {
  ScannerBoundingBox,
  ScannerCapabilityState,
  ScannerMode,
  ScannerScanEvent,
  ScannerStatus,
  ScannerStatusEvent,
} from "../types/cameraScanner";

type DetectedBarcodeLike = {
  rawValue?: string;
  boundingBox?: DOMRectReadOnly | { x: number; y: number; width: number; height: number };
};

type FrameMetrics = {
  brightness: number;
  glareRatio: number;
  sharpness: number;
};

type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): { detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeLike[]> };
  getSupportedFormats?: () => Promise<string[]>;
};

type UseCameraBarcodeScannerOptions = {
  mode: () => ScannerMode;
  autoAccept: () => boolean;
  onScanned: (event: ScannerScanEvent) => void;
  onStatus: (event: ScannerStatusEvent) => void;
};

const FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "qr_code",
  "data_matrix",
  "pdf417",
  "aztec",
] as const;

const RECENT_SCAN_DEBOUNCE_MS = 1600;
const STATUS_EMIT_DEBOUNCE_MS = 500;
const SCAN_INTERVAL_MS = 110;
const DETECTION_HOLD_MS = 520;
const BOX_SMOOTHING = 0.42;

const statusMessage = (status: ScannerStatus) => {
  switch (status) {
    case "success":
      return "Barcode is clear and ready to scan.";
    case "low_light":
      return "Too little light. Brighten the scene and try again.";
    case "glare":
      return "Glare detected. Tilt the barcode or camera to reduce reflection.";
    case "blurry":
      return "Image looks blurry. Hold the device steadier, move a little closer, or pause briefly.";
    default:
      return "Barcode is not being decoded yet. Move closer, flatten the label, and let the barcode fill more of the camera view.";
  }
};

const getBarcodeDetectorCtor = (): BarcodeDetectorCtor | null => {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
};

const toBoundingBox = (box?: DetectedBarcodeLike["boundingBox"]): ScannerBoundingBox | null => {
  if (!box) return null;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
};

const getTorchSupport = (track: MediaStreamTrack | null) => {
  if (!track || typeof (track as MediaStreamTrack & { getCapabilities?: () => MediaTrackCapabilities }).getCapabilities !== "function") {
    return false;
  }
  const capabilities = (track as MediaStreamTrack & { getCapabilities: () => MediaTrackCapabilities }).getCapabilities() as MediaTrackCapabilities & {
    torch?: boolean;
  };
  return Boolean(capabilities.torch);
};

const chooseStatus = (metrics: FrameMetrics, hasDetection: boolean): ScannerStatus => {
  if (metrics.brightness < 34) return "low_light";
  if (metrics.glareRatio > 0.26) return "glare";
  if (metrics.sharpness < 8) return "blurry";
  return hasDetection ? "success" : "unscannable";
};

export const useCameraBarcodeScanner = (options: UseCameraBarcodeScannerOptions) => {
  const isOpen = ref(false);
  const isStarting = ref(false);
  const permissionDenied = ref(false);
  const errorMessage = ref("");
  const status = ref<ScannerStatus>("unscannable");
  const statusMessageText = ref(statusMessage("unscannable"));
  const currentDetection = ref<ScannerScanEvent | null>(null);
  const previewBox = ref<ScannerBoundingBox | null>(null);
  const torchEnabled = ref(false);
  const videoRef = ref<HTMLVideoElement | null>(null);
  const capabilities = ref<ScannerCapabilityState>({
    cameraSupported: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    barcodeDetectorSupported: !!getBarcodeDetectorCtor(),
    flashlightSupported: false,
    canFlipCamera: false,
  });

  const hasActiveCandidate = computed(() => !!currentDetection.value);

  let stream: MediaStream | null = null;
  let currentTrack: MediaStreamTrack | null = null;
  let detector: InstanceType<BarcodeDetectorCtor> | null = null;
  let scanTimer: number | null = null;
  let devices: string[] = [];
  let deviceIndex = 0;
  let usingRearCamera = true;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let lastScanValue = "";
  let lastScanAt = 0;
  let lastStatusKey = "";
  let lastStatusAt = 0;
  let lastDetectionAt = 0;

  const emitStatus = (nextStatus: ScannerStatus, value?: string, box?: ScannerBoundingBox | null) => {
    const timestamp = new Date().toISOString();
    const key = `${nextStatus}:${value ?? ""}`;
    if (key === lastStatusKey && Date.now() - lastStatusAt < STATUS_EMIT_DEBOUNCE_MS) {
      status.value = nextStatus;
      statusMessageText.value = statusMessage(nextStatus);
      return;
    }
    lastStatusKey = key;
    lastStatusAt = Date.now();
    status.value = nextStatus;
    statusMessageText.value = statusMessage(nextStatus);
    options.onStatus({
      status: nextStatus,
      timestamp,
      message: statusMessage(nextStatus),
      mode: options.mode(),
      value,
      boundingBox: box ?? null,
    });
  };

  const stopLoop = () => {
    if (scanTimer !== null) {
      window.clearInterval(scanTimer);
      scanTimer = null;
    }
  };

  const stopStream = () => {
    stopLoop();
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    stream = null;
    currentTrack = null;
    if (videoRef.value) {
      videoRef.value.pause();
      videoRef.value.srcObject = null;
    }
    torchEnabled.value = false;
    capabilities.value = {
      ...capabilities.value,
      flashlightSupported: false,
      canFlipCamera: devices.length > 1,
    };
  };

  const analyzeFrame = (): FrameMetrics => {
    const video = videoRef.value;
    if (!video || !context || !canvas) return { brightness: 0, glareRatio: 0, sharpness: 0 };
    const width = 240;
    const height = 180;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    let brightnessTotal = 0;
    let glareCount = 0;
    let sharpnessTotal = 0;
    let sampleCount = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const index = (y * width + x) * 4;
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        brightnessTotal += luminance;
        if (luminance > 240) glareCount += 1;
        if (x + 4 < width && y + 4 < height) {
          const rightIndex = (y * width + (x + 4)) * 4;
          const downIndex = ((y + 4) * width + x) * 4;
          const rightLum = 0.2126 * (data[rightIndex] ?? 0) + 0.7152 * (data[rightIndex + 1] ?? 0) + 0.0722 * (data[rightIndex + 2] ?? 0);
          const downLum = 0.2126 * (data[downIndex] ?? 0) + 0.7152 * (data[downIndex + 1] ?? 0) + 0.0722 * (data[downIndex + 2] ?? 0);
          sharpnessTotal += Math.abs(luminance - rightLum) + Math.abs(luminance - downLum);
        }
        sampleCount += 1;
      }
    }
    return {
      brightness: sampleCount ? brightnessTotal / sampleCount : 0,
      glareRatio: sampleCount ? glareCount / sampleCount : 0,
      sharpness: sampleCount ? sharpnessTotal / sampleCount : 0,
    };
  };

  const detectInCenterRegion = async (video: HTMLVideoElement): Promise<DetectedBarcodeLike | null> => {
    if (!detector || !canvas || !context || !video.videoWidth || !video.videoHeight) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const region = {
      width: sourceWidth * 0.72,
      height: sourceHeight * 0.38,
      x: sourceWidth * 0.14,
      y: sourceHeight * 0.31,
    };

    canvas.width = Math.max(1, Math.round(region.width * 1.4));
    canvas.height = Math.max(1, Math.round(region.height * 1.4));
    context.drawImage(
      video,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const matches = await detector.detect(canvas);
    const firstMatch = matches.find((item) => Boolean(item.rawValue?.trim()));
    if (!firstMatch) return null;

    const box = toBoundingBox(firstMatch.boundingBox);
    if (!box) return firstMatch;

    const scaleX = region.width / canvas.width;
    const scaleY = region.height / canvas.height;
    return {
      ...firstMatch,
      boundingBox: {
        x: region.x + box.x * scaleX,
        y: region.y + box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      },
    };
  };

  const updatePreviewBox = (box: ScannerBoundingBox | null) => {
    const video = videoRef.value;
    if (!video || !box || !video.videoWidth || !video.videoHeight) {
      previewBox.value = box;
      return;
    }
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const offsetX = (scaledWidth - displayWidth) / 2;
    const offsetY = (scaledHeight - displayHeight) / 2;
    const nextBox = {
      x: box.x * scale - offsetX,
      y: box.y * scale - offsetY,
      width: box.width * scale,
      height: box.height * scale,
    };
    if (!previewBox.value) {
      previewBox.value = nextBox;
      return;
    }
    previewBox.value = {
      x: previewBox.value.x + (nextBox.x - previewBox.value.x) * BOX_SMOOTHING,
      y: previewBox.value.y + (nextBox.y - previewBox.value.y) * BOX_SMOOTHING,
      width: previewBox.value.width + (nextBox.width - previewBox.value.width) * BOX_SMOOTHING,
      height: previewBox.value.height + (nextBox.height - previewBox.value.height) * BOX_SMOOTHING,
    };
  };

  const acceptDetection = (value: string, box: ScannerBoundingBox | null, nextStatus: ScannerStatus, force = false) => {
    const now = Date.now();
    if (!force && value === lastScanValue && now - lastScanAt < RECENT_SCAN_DEBOUNCE_MS) {
      return;
    }
    lastScanValue = value;
    lastScanAt = now;
    const event: ScannerScanEvent = {
      value,
      timestamp: new Date(now).toISOString(),
      status: nextStatus,
      boundingBox: box,
      mode: options.mode(),
    };
    currentDetection.value = event;
    previewBox.value = box;
    options.onScanned(event);
    emitStatus(nextStatus, value, box);
  };

  const scanFrame = async () => {
    const video = videoRef.value;
    if (!video || !detector || video.readyState < 2) return;

    const metrics = analyzeFrame();
    try {
      const matches = await detector.detect(video);
      let firstMatch = matches.find((item) => Boolean(item.rawValue?.trim())) ?? null;
      if (!firstMatch) {
        firstMatch = await detectInCenterRegion(video);
      }
      const box = toBoundingBox(firstMatch?.boundingBox);

      if (box) {
        updatePreviewBox(box);
      }

      if (firstMatch?.rawValue) {
        const value = firstMatch.rawValue.trim();
        const nextStatus = chooseStatus(metrics, true);
        lastDetectionAt = Date.now();
        currentDetection.value = {
          value,
          timestamp: new Date().toISOString(),
          status: nextStatus,
          boundingBox: box,
          mode: options.mode(),
        };
        if (options.autoAccept() && nextStatus === "success") {
          acceptDetection(value, box, nextStatus);
        } else {
          emitStatus(nextStatus, value, box);
        }
        return;
      }

      const now = Date.now();
      if (currentDetection.value && now - lastDetectionAt < DETECTION_HOLD_MS) {
        emitStatus(chooseStatus(metrics, false), currentDetection.value.value, currentDetection.value.boundingBox);
        return;
      }

      currentDetection.value = null;
      previewBox.value = null;
      emitStatus(chooseStatus(metrics, false));
    } catch {
      const now = Date.now();
      if (currentDetection.value && now - lastDetectionAt < DETECTION_HOLD_MS) {
        emitStatus(currentDetection.value.status, currentDetection.value.value, currentDetection.value.boundingBox);
        return;
      }
      currentDetection.value = null;
      previewBox.value = null;
      emitStatus("unscannable");
    }
  };

  const startLoop = () => {
    stopLoop();
    scanTimer = window.setInterval(() => {
      void scanFrame();
    }, SCAN_INTERVAL_MS);
  };

  const refreshCapabilities = async () => {
    try {
      const listedDevices = await navigator.mediaDevices.enumerateDevices();
      devices = listedDevices.filter((device) => device.kind === "videoinput").map((device) => device.deviceId);
      capabilities.value = {
        ...capabilities.value,
        canFlipCamera: devices.length > 1,
        flashlightSupported: getTorchSupport(currentTrack),
      };
    } catch {
      capabilities.value = {
        ...capabilities.value,
        flashlightSupported: getTorchSupport(currentTrack),
      };
    }
  };

  const startCamera = async () => {
    if (!capabilities.value.cameraSupported) {
      errorMessage.value = "This device or browser does not support camera access here.";
      return;
    }
    const DetectorCtor = getBarcodeDetectorCtor();
    capabilities.value = {
      ...capabilities.value,
      barcodeDetectorSupported: !!DetectorCtor,
    };
    if (!DetectorCtor) {
      errorMessage.value = "Barcode scanning is not supported in this browser. Use manual barcode entry instead.";
      return;
    }

    isStarting.value = true;
    permissionDenied.value = false;
    errorMessage.value = "";
    currentDetection.value = null;
    previewBox.value = null;

    try {
      stopStream();
      detector = new DetectorCtor({ formats: [...FORMATS] });
      const constraints: MediaStreamConstraints = {
        video: devices[deviceIndex]
          ? { deviceId: { exact: devices[deviceIndex] } }
          : { facingMode: usingRearCamera ? { ideal: "environment" } : { ideal: "user" } },
        audio: false,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentTrack = stream.getVideoTracks()[0] ?? null;
      if (!currentTrack) {
        throw new Error("No camera track available.");
      }
      if (videoRef.value) {
        videoRef.value.srcObject = stream;
        await videoRef.value.play();
      }
      await refreshCapabilities();
      startLoop();
    } catch (error) {
      permissionDenied.value = true;
      errorMessage.value =
        error instanceof Error && error.message
          ? "Camera access was blocked or unavailable. Use manual entry if camera scanning cannot be enabled."
          : "Camera access was blocked or unavailable. Use manual entry if camera scanning cannot be enabled.";
      stopStream();
    } finally {
      isStarting.value = false;
    }
  };

  const open = async () => {
    isOpen.value = true;
    await startCamera();
  };

  const close = () => {
    isOpen.value = false;
    stopStream();
    currentDetection.value = null;
    previewBox.value = null;
    errorMessage.value = "";
  };

  const toggleTorch = async () => {
    if (!currentTrack || !getTorchSupport(currentTrack)) return;
    const next = !torchEnabled.value;
    try {
      await currentTrack.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      torchEnabled.value = next;
    } catch {
      torchEnabled.value = false;
    }
  };

  const flipCamera = async () => {
    if (!capabilities.value.canFlipCamera) return;
    if (devices.length > 1) {
      deviceIndex = (deviceIndex + 1) % devices.length;
    } else {
      usingRearCamera = !usingRearCamera;
    }
    await startCamera();
  };

  const manualConfirm = () => {
    if (!currentDetection.value) return;
    acceptDetection(
      currentDetection.value.value,
      currentDetection.value.boundingBox,
      currentDetection.value.status,
      true
    );
  };

  onUnmounted(() => {
    stopStream();
  });

  if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d", { willReadFrequently: true });
  }

  return {
    isOpen,
    isStarting,
    permissionDenied,
    errorMessage,
    status,
    statusMessageText,
    currentDetection,
    previewBox,
    torchEnabled,
    videoRef,
    capabilities,
    hasActiveCandidate,
    open,
    close,
    toggleTorch,
    flipCamera,
    manualConfirm,
  };
};
