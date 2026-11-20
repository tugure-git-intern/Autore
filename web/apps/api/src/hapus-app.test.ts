import { describe, expect, it } from "vitest";
import { argvHapusApp, bacaBodyHapusApp, bersihkanAnsi } from "./hapus-app";

describe("argvHapusApp", () => {
  it("menyusun argv hapus-app dengan konfirmasi nama", () => {
    expect(argvHapusApp("app-a", "app-a")).toEqual(["hapus-app", "app-a", "--konfirmasi", "app-a"]);
  });
});

describe("bersihkanAnsi", () => {
  it("membuang escape warna supaya dashboard tidak menerima kode ANSI mentah", () => {
    const berwarna =
      "\u001b[32m\u001b[1m✔\u001b[0m registry.tsv dibersihkan\n\u001b[31m\u001b[1m✖\u001b[0m job Jenkins gagal";

    expect(bersihkanAnsi(berwarna)).toBe("✔ registry.tsv dibersihkan\n✖ job Jenkins gagal");
  });
});

describe("bacaBodyHapusApp", () => {
  it("menerima body {app, konfirmasi}", () => {
    expect(bacaBodyHapusApp({ app: "app-a", konfirmasi: "app-a" })).toEqual({
      ok: true,
      nilai: { app: "app-a", konfirmasi: "app-a" },
    });
  });

  it("menolak kunci asing, app bukan string, dan body yang bukan objek", () => {
    expect(bacaBodyHapusApp({ app: "app-a", konfirmasi: "app-a", extra: 1 }).ok).toBe(false);
    expect(bacaBodyHapusApp({ app: 123, konfirmasi: "app-a" }).ok).toBe(false);
    expect(bacaBodyHapusApp({ konfirmasi: "app-a" }).ok).toBe(false);
    expect(bacaBodyHapusApp(null).ok).toBe(false);
  });
});
