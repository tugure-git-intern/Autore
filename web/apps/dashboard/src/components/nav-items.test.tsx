import { describe, expect, it } from "vitest";

import { navItemsUntuk } from "./nav-items";

const href = (role: Parameters<typeof navItemsUntuk>[0]) => navItemsUntuk(role).map((i) => i.href);

describe("navItemsUntuk", () => {
  it("admin mendapat enam tujuan termasuk /settings", () => {
    expect(href("admin")).toEqual([
      "/",
      "/applications",
      "/pipeline",
      "/security",
      "/audit",
      "/settings",
    ]);
  });

  it("qa dan dev tidak mendapat /settings — role di bawah admin", () => {
    for (const role of ["qa", "dev"] as const) {
      expect(href(role)).not.toContain("/settings");
      expect(href(role)).toHaveLength(5);
    }
  });

  it("tanpa role (belum login / token lama) tidak mendapat /settings", () => {
    expect(href(null)).toHaveLength(5);
    expect(href(null)).not.toContain("/settings");
  });

  it("urutan menu sama untuk semua role; /settings selalu terakhir", () => {
    const admin = href("admin");
    expect(admin.slice(0, 5)).toEqual(href("dev"));
  });
});
