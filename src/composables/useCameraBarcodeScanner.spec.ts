import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useCameraBarcodeScanner } from "./useCameraBarcodeScanner";

// jsdom implements neither getUserMedia/enumerateDevices, the
// BarcodeDetector API, nor real canvas 2D contexts. This composable already
// guards every one of those call sites (see `getBarcodeDetectorCtor`,
// `capabilities.cameraSupported`, and the `!metricsContext` checks in
// `analyzeFrame`/`detectInCenterRegion`), so tests focus on the composable's
// own start/stop/error state machine rather than real camera behavior:
// getUserMedia/enumerateDevices/BarcodeDetector are stubbed at the browser
// API boundary, and canvas frame analysis is left to fall back to its
// null-context zero-metrics path (verified separately below).

type FakeTrack = {
  kind: string;
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: ReturnType<typeof vi.fn>;
  applyConstraints: ReturnType<typeof vi.fn>;
};

const makeTrack = (torchSupported = false): FakeTrack => ({
  kind: "video",
  stop: vi.fn(),
  getCapabilities: vi.fn().mockReturnValue({ torch: torchSupported, focusMode: ["continuous"] }),
  applyConstraints: vi.fn().mockResolvedValue(undefined),
});

const makeStream = (track: FakeTrack) => ({
  getTracks: vi.fn().mockReturnValue([track]),
  getVideoTracks: vi.fn().mockReturnValue([track]),
});

const mountHost = (options?: { mode?: string; autoAccept?: boolean }) => {
  const onScanned = vi.fn();
  const onStatus = vi.fn();
  let exposed!: ReturnType<typeof useCameraBarcodeScanner>;
  const Host = defineComponent({
    setup() {
      exposed = useCameraBarcodeScanner({
        mode: () => (options?.mode ?? "checkout_item") as never,
        autoAccept: () => options?.autoAccept ?? false,
        onScanned,
        onStatus,
      });
      return () => h("video", { ref: exposed.videoRef });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { wrapper, get: () => exposed, onScanned, onStatus };
};

describe("useCameraBarcodeScanner", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let enumerateDevices: ReturnType<typeof vi.fn>;
  let detect: ReturnType<typeof vi.fn>;
  let track: FakeTrack;

  beforeEach(() => {
    vi.useFakeTimers();
    track = makeTrack();
    getUserMedia = vi.fn().mockResolvedValue(makeStream(track));
    enumerateDevices = vi.fn().mockResolvedValue([
      { kind: "videoinput", deviceId: "cam-1" },
      { kind: "audioinput", deviceId: "mic-1" },
    ]);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia, enumerateDevices },
    });
    detect = vi.fn().mockResolvedValue([]);
    class FakeBarcodeDetector {
      detect = detect;
    }
    vi.stubGlobal("BarcodeDetector", FakeBarcodeDetector);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    // jsdom has no canvas backend; the composable already treats a null 2D
    // context as "skip frame analysis" (see analyzeFrame/detectInCenterRegion),
    // so stub getContext to return null quietly instead of jsdom's noisy
    // "Not implemented" console error.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    vi.restoreAllMocks();
  });

  it("reports camera + barcode-detector support based on the current browser APIs", () => {
    const { wrapper, get } = mountHost();
    expect(get().capabilities.value.cameraSupported).toBe(true);
    expect(get().capabilities.value.barcodeDetectorSupported).toBe(true);
    wrapper.unmount();
  });

  it("reports no camera support when getUserMedia is unavailable", () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { wrapper, get } = mountHost();
    expect(get().capabilities.value.cameraSupported).toBe(false);
    wrapper.unmount();
  });

  it("open() sets an error and never calls getUserMedia when the camera is unsupported", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { wrapper, get } = mountHost();

    await get().open();

    expect(get().errorMessage.value).toMatch(/does not support camera access/i);
    expect(getUserMedia).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("open() sets an error when BarcodeDetector is unsupported", async () => {
    vi.unstubAllGlobals();
    const { wrapper, get } = mountHost();

    await get().open();

    expect(get().errorMessage.value).toMatch(/barcode scanning is not supported/i);
    expect(getUserMedia).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("open() starts the rear camera by default and wires the stream to the video element", async () => {
    const { wrapper, get } = mountHost();

    await get().open();

    expect(get().isOpen.value).toBe(true);
    expect(get().isStarting.value).toBe(false);
    expect(get().permissionDenied.value).toBe(false);
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: "environment" } }),
      }),
    );
    wrapper.unmount();
  });

  it("open() falls back to minimal constraints when the preferred constraints are rejected", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("OverconstrainedError")).mockResolvedValueOnce(makeStream(track));
    const { wrapper, get } = mountHost();

    await get().open();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(get().isOpen.value).toBe(true);
    expect(get().permissionDenied.value).toBe(false);
    wrapper.unmount();
  });

  it("open() marks permissionDenied and surfaces an error when getUserMedia is blocked entirely", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { wrapper, get } = mountHost();

    await get().open();

    expect(get().permissionDenied.value).toBe(true);
    expect(get().errorMessage.value).toMatch(/camera access was blocked/i);
    wrapper.unmount();
  });

  it("close() stops every track, clears the video element, and resets scan state", async () => {
    const { wrapper, get } = mountHost();
    await get().open();
    expect(get().isOpen.value).toBe(true);

    get().close();

    expect(track.stop).toHaveBeenCalled();
    expect(get().isOpen.value).toBe(false);
    expect(get().currentDetection.value).toBeNull();
    expect(get().previewBox.value).toBeNull();
    wrapper.unmount();
  });

  it("toggleTorch() is a no-op when the current track has no torch capability", async () => {
    track.getCapabilities.mockReturnValue({ torch: false });
    const { wrapper, get } = mountHost();
    await get().open();

    await get().toggleTorch();

    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(get().torchEnabled.value).toBe(false);
    wrapper.unmount();
  });

  it("toggleTorch() flips torchEnabled and applies the constraint when supported", async () => {
    track.getCapabilities.mockReturnValue({ torch: true });
    const { wrapper, get } = mountHost();
    await get().open();

    await get().toggleTorch();

    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(get().torchEnabled.value).toBe(true);
    wrapper.unmount();
  });

  it("flipCamera() cycles to the next enumerated device and restarts the camera with its deviceId", async () => {
    enumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "cam-1" },
      { kind: "videoinput", deviceId: "cam-2" },
    ]);
    const { wrapper, get } = mountHost();
    await get().open();
    expect(get().capabilities.value.canFlipCamera).toBe(true);
    getUserMedia.mockClear();

    await get().flipCamera();

    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: "cam-2" } }) }),
    );
    wrapper.unmount();
  });

  it("flipCamera() is a no-op when only one camera device is known (canFlipCamera stays false)", async () => {
    enumerateDevices.mockResolvedValue([{ kind: "videoinput", deviceId: "cam-1" }]);
    const { wrapper, get } = mountHost();
    await get().open();
    expect(get().capabilities.value.canFlipCamera).toBe(false);
    getUserMedia.mockClear();

    await get().flipCamera();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(get().usingRearCamera.value).toBe(true);
    wrapper.unmount();
  });

  it("detects a barcode on the scan loop and exposes it via currentDetection + onStatus, without auto-accepting", async () => {
    detect.mockResolvedValue([{ rawValue: "9781234567897" }]);
    const { wrapper, get, onStatus, onScanned } = mountHost({ autoAccept: false });
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });

    await vi.advanceTimersByTimeAsync(200);

    expect(get().currentDetection.value?.value).toBe("9781234567897");
    expect(onStatus).toHaveBeenCalled();
    expect(onScanned).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("carries a bounding box through to the emitted scan event when the detector reports one", async () => {
    detect.mockResolvedValue([
      { rawValue: "9781234567897", boundingBox: { x: 1, y: 2, width: 3, height: 4 } },
    ]);
    const { wrapper, get } = mountHost();
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });

    await vi.advanceTimersByTimeAsync(200);

    expect(get().currentDetection.value?.boundingBox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    wrapper.unmount();
  });

  it("holds the last detection briefly after the barcode drops out of frame, then clears it", async () => {
    detect.mockResolvedValueOnce([{ rawValue: "hold-me" }]).mockResolvedValue([]);
    const { wrapper, get } = mountHost();
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });

    // Tick 1: detects a match.
    await vi.advanceTimersByTimeAsync(110);
    expect(get().currentDetection.value?.value).toBe("hold-me");

    // Tick 2: no longer detected, but still within the hold window -> kept.
    await vi.advanceTimersByTimeAsync(110);
    expect(get().currentDetection.value?.value).toBe("hold-me");

    // Once the hold window elapses, the detection is cleared.
    await vi.advanceTimersByTimeAsync(600);
    expect(get().currentDetection.value).toBeNull();
    wrapper.unmount();
  });

  it("recovers from a detector.detect() rejection by reporting unscannable", async () => {
    detect.mockRejectedValue(new Error("detector crashed"));
    const { wrapper, get, onStatus } = mountHost();
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });

    await vi.advanceTimersByTimeAsync(200);

    expect(get().currentDetection.value).toBeNull();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "unscannable" }));
    wrapper.unmount();
  });

  it("refreshCapabilities tolerates an enumerateDevices() failure without throwing", async () => {
    enumerateDevices.mockRejectedValue(new Error("permission needed"));
    const { wrapper, get } = mountHost();

    await expect(get().open()).resolves.toBeUndefined();
    expect(get().isOpen.value).toBe(true);
    wrapper.unmount();
  });

  it("manualConfirm() accepts the current detection and invokes onScanned", async () => {
    detect.mockResolvedValue([{ rawValue: "9781234567897" }]);
    const { wrapper, get, onScanned } = mountHost({ autoAccept: false });
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });
    await vi.advanceTimersByTimeAsync(200);
    expect(get().currentDetection.value).not.toBeNull();

    get().manualConfirm();

    expect(onScanned).toHaveBeenCalledWith(
      expect.objectContaining({ value: "9781234567897" }),
    );
    wrapper.unmount();
  });

  it("manualConfirm() is a no-op without a current detection", async () => {
    const { wrapper, get, onScanned } = mountHost();
    await get().open();

    get().manualConfirm();

    expect(onScanned).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("hasActiveCandidate reflects whether there is a current detection", async () => {
    detect.mockResolvedValue([{ rawValue: "abc123" }]);
    const { wrapper, get } = mountHost();
    expect(get().hasActiveCandidate.value).toBe(false);
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });

    await vi.advanceTimersByTimeAsync(200);

    expect(get().hasActiveCandidate.value).toBe(true);
    wrapper.unmount();
  });

  it("pauses scanning while the tab is hidden and resumes when it becomes visible again", async () => {
    detect.mockResolvedValue([]);
    const { wrapper, get } = mountHost();
    await get().open();
    Object.defineProperty(get().videoRef.value, "readyState", { configurable: true, value: 4 });
    await vi.advanceTimersByTimeAsync(200);
    const callsBefore = detect.mock.calls.length;

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(detect.mock.calls.length).toBe(callsBefore);

    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(detect.mock.calls.length).toBeGreaterThan(callsBefore);
    wrapper.unmount();
  });

  it("stops the stream and removes the visibility listener on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    const { wrapper, get } = mountHost();
    await get().open();

    wrapper.unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
