import { beforeEach, describe, expect, it, vi } from "vitest";
import { preloadImages } from "./preloadImages";

describe("preloadImages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preloads each non-empty URL once", () => {
    const instances: Array<{ decoding: string; src: string }> = [];
    class FakeImage {
      decoding = "";
      private _src = "";

      get src() {
        return this._src;
      }

      set src(value: string) {
        this._src = value;
        instances.push(this);
      }
    }

    vi.stubGlobal("Image", FakeImage);

    preloadImages(["/brand/logo-light.png", "", null, "/brand/logo-light.png", "/brand/logo-dark.png"]);
    preloadImages(["/brand/logo-light.png", "/brand/logo-dark.png"]);

    expect(instances).toHaveLength(2);
    expect(instances.map((image) => image.src)).toEqual([
      "/brand/logo-light.png",
      "/brand/logo-dark.png",
    ]);
    expect(instances.every((image) => image.decoding === "async")).toBe(true);
  });
});
