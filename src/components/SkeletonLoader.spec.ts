import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SkeletonLoader from "./SkeletonLoader.vue";

describe("SkeletonLoader", () => {
  it("renders a table-shaped loading state with a header and varied bones", () => {
    const wrapper = mount(SkeletonLoader, {
      props: {
        variant: "table",
        rows: 2,
        columns: 4,
        actionColumn: true,
        label: "Loading borrowers",
      },
    });

    expect(wrapper.attributes("role")).toBe("status");
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.attributes("aria-label")).toBe("Loading borrowers");
    expect(wrapper.findAll(".skeleton-table-row")).toHaveLength(3);
    expect(wrapper.findAll(".skeleton-table-header .skeleton-line")).toHaveLength(4);
    expect(wrapper.findAll(".skeleton-table-cell")).toHaveLength(8);
    expect(wrapper.findAll(".skeleton-line-action")).toHaveLength(2);

    const bodyLines = wrapper.findAll(".skeleton-table-cell .skeleton-line");
    expect(bodyLines[0]?.attributes("style")).toContain("width:");
    expect(bodyLines[0]?.attributes("style")).not.toBe(bodyLines[1]?.attributes("style"));
  });

  it("keeps line and card variants available", () => {
    const lines = mount(SkeletonLoader, { props: { rows: 3 } });
    expect(lines.findAll(".skeleton-line")).toHaveLength(3);
    expect(lines.findAll(".skeleton-line-title")).toHaveLength(1);
    expect(lines.findAll(".skeleton-line-short")).toHaveLength(1);

    const cards = mount(SkeletonLoader, { props: { variant: "card", rows: 2 } });
    expect(cards.findAll(".skeleton-card")).toHaveLength(2);
    expect(cards.findAll(".skeleton-avatar")).toHaveLength(2);
  });
});
