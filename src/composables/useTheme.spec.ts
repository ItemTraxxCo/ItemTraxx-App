import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    useTheme().setTheme("light");
  });

  it("shares theme state across every call site", () => {
    const a = useTheme();
    const b = useTheme();
    a.setTheme("dark");
    expect(b.theme.value).toBe("dark");
    expect(b.themeLabel.value).toBe("Light Mode");
  });

  it("persists the chosen theme to localStorage and the DOM", () => {
    useTheme().setTheme("dark");
    expect(localStorage.getItem("itemtraxx-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggleTheme flips between light and dark", () => {
    useTheme().setTheme("light");
    useTheme().toggleTheme();
    expect(useTheme().theme.value).toBe("dark");
  });
});
