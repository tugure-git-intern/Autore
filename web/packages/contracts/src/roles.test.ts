import { describe, expect, it } from "vitest";
import {
  ROLE_ORDER,
  parseAllowlist,
  parseAllowlistEnv,
  parseRole,
  roleAtLeast,
  roleFor,
} from "./roles";

describe("urutan role", () => {
  it("dev < qa < admin untuk semua pasangan", () => {
    expect(roleAtLeast("dev", "dev")).toBe(true);
    expect(roleAtLeast("dev", "qa")).toBe(false);
    expect(roleAtLeast("dev", "admin")).toBe(false);
    expect(roleAtLeast("qa", "dev")).toBe(true);
    expect(roleAtLeast("qa", "qa")).toBe(true);
    expect(roleAtLeast("qa", "admin")).toBe(false);
    expect(roleAtLeast("admin", "dev")).toBe(true);
    expect(roleAtLeast("admin", "qa")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
  });

  it("setiap role dihitung terhadap setiap role lain tanpa pengecualian", () => {
    for (const [i, role] of ROLE_ORDER.entries()) {
      for (const [j, minimum] of ROLE_ORDER.entries()) {
        expect(roleAtLeast(role, minimum)).toBe(i >= j);
      }
    }
  });
});

describe("parseRole", () => {
  it("menerima tiga role yang dikenal dan menolak sisanya", () => {
    expect(parseRole("dev")).toBe("dev");
    expect(parseRole("qa")).toBe("qa");
    expect(parseRole("admin")).toBe("admin");
    expect(parseRole("owner")).toBeNull();
    expect(parseRole("ADMIN")).toBeNull();
    expect(parseRole("")).toBeNull();
    expect(parseRole(null)).toBeNull();
    expect(parseRole(1)).toBeNull();
    expect(parseRole({ role: "admin" })).toBeNull();
  });
});

describe("parseAllowlist", () => {
  it("bentuk lama (larik string) diperlakukan sebagai admin", () => {
    const users = parseAllowlist(["alif", "tugure-git-intern"]);
    expect(roleFor(users, "alif")).toBe("admin");
    expect(roleFor(users, "Tugure-Git-Intern")).toBe("admin");
  });

  it("bentuk peta login ke role", () => {
    const users = parseAllowlist({ "tugure-git-intern": "admin", maliffadlan: "dev" });
    expect(roleFor(users, "tugure-git-intern")).toBe("admin");
    expect(roleFor(users, "maliffadlan")).toBe("dev");
  });

  it("role tidak valid dibuang, bukan dijadikan admin", () => {
    const users = parseAllowlist({ maliffadlan: "dev", nakal: "owner", kosong: "" });
    expect(roleFor(users, "maliffadlan")).toBe("dev");
    expect(roleFor(users, "nakal")).toBeNull();
    expect(roleFor(users, "kosong")).toBeNull();
  });

  it("login tidak dikenal ditolak", () => {
    expect(roleFor(parseAllowlist({ maliffadlan: "dev" }), "orang-luar")).toBeNull();
  });

  it("nilai berbentuk salah menjadi peta kosong (semua ditolak)", () => {
    expect(parseAllowlist("maliffadlan").size).toBe(0);
    expect(parseAllowlist(null).size).toBe(0);
    expect(parseAllowlist(7).size).toBe(0);
    expect(parseAllowlist([1, null]).size).toBe(0);
  });
});

describe("parseAllowlistEnv", () => {
  it("mendukung login tanpa role (admin) dan login:role", () => {
    const users = parseAllowlistEnv("tugure-git-intern:admin, maliffadlan:dev,alif");
    expect(roleFor(users, "tugure-git-intern")).toBe("admin");
    expect(roleFor(users, "maliffadlan")).toBe("dev");
    expect(roleFor(users, "alif")).toBe("admin");
  });

  it("entri kosong dan role tidak dikenal dibuang", () => {
    const users = parseAllowlistEnv(" , maliffadlan:dev , nakal:owner, ");
    expect(users.size).toBe(1);
    expect(roleFor(users, "maliffadlan")).toBe("dev");
    expect(roleFor(users, "nakal")).toBeNull();
  });
});
