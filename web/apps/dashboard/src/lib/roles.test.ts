import { describe, expect, it } from "vitest";
import { allowlistMap, isAllowed } from "./allowlist";
import { ROLE_ORDER, parseRole, roleAtLeast, roleDariAllowlist } from "./roles";

describe("urutan role", () => {
  it("dev < qa < admin dan batasnya inklusif", () => {
    expect(ROLE_ORDER).toEqual(["dev", "qa", "admin"]);
    expect(roleAtLeast("dev", "dev")).toBe(true);
    expect(roleAtLeast("dev", "qa")).toBe(false);
    expect(roleAtLeast("qa", "qa")).toBe(true);
    expect(roleAtLeast("qa", "admin")).toBe(false);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "dev")).toBe(true);
  });

  it("role tidak dikenal tidak pernah jadi role", () => {
    expect(parseRole("root")).toBeNull();
    expect(parseRole("qaa")).toBeNull();
    expect(parseRole("ADMIN")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
    expect(parseRole(3)).toBeNull();
  });
});

describe("dua bentuk allowlist di tingkat dashboard", () => {
  it("larik string lama berarti semua admin", () => {
    const peta = allowlistMap(["alif", " Tugure-Git-Intern "], undefined);
    expect(peta.get("alif")).toBe("admin");
    expect(peta.get("tugure-git-intern")).toBe("admin");
  });

  it("peta login → role dipakai apa adanya dan login dinormalkan", () => {
    const peta = allowlistMap({ alif: "qa", "Tugure-Git-Intern": "admin" }, undefined);
    expect(roleDariAllowlist("Alif", peta)).toBe("qa");
    expect(roleDariAllowlist("tugure-git-intern", peta)).toBe("admin");
    expect(roleDariAllowlist("orang-luar", peta)).toBeNull();
  });

  it("entri ber-role tidak valid dibuang, jadi login itu ditolak", () => {
    const peta = allowlistMap({ alif: "qa", budi: "root", "": "admin" }, undefined);
    expect(peta.has("alif")).toBe(true);
    expect(peta.has("budi")).toBe(false);
    expect(isAllowed("budi", peta)).toBe(false);
    expect(roleDariAllowlist("budi", peta)).toBeNull();
  });

  it("bentuk yang sama sekali salah = peta kosong, bukan izin penuh", () => {
    expect(allowlistMap("alif", undefined).size).toBe(0);
    expect(allowlistMap(null, undefined).size).toBe(0);
  });

  it("env AUTORE_ALLOWED_USERS menimpa berkas dan membawa role", () => {
    const peta = allowlistMap(["dari-berkas"], "alif:qa, budi");
    expect([...peta.keys()].sort()).toEqual(["alif", "budi"]);
    expect(peta.get("alif")).toBe("qa");
    expect(peta.get("budi")).toBe("admin");
    expect(peta.has("dari-berkas")).toBe(false);
  });
});
