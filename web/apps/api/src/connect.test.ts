import { describe, expect, it } from "vitest";
import { argvConnect, bacaBodyConnect } from "./connect";
import { repoDariOutput } from "./quick-start";

describe("bacaBodyConnect", () => {
  it("menerima repo saja dan memakai default branch main", () => {
    const hasil = bacaBodyConnect({ repo: "https://github.com/tugure-reasuransi/autore-demo" });
    expect(hasil).toEqual({
      ok: true,
      nilai: {
        repo: "https://github.com/tugure-reasuransi/autore-demo",
        branch: "main",
        nama: "autore-demo",
      },
    });
  });

  it("menghormati nama dan branch pilihan dev", () => {
    const hasil = bacaBodyConnect({
      repo: "https://github.com/a/b.git",
      nama: "  demo-saya ",
      branch: "rilis",
      stack: "go",
    });
    expect(hasil.ok && hasil.nilai).toEqual({
      repo: "https://github.com/a/b",
      nama: "demo-saya",
      branch: "rilis",
      stack: "go",
    });
  });

  it("menolak host selain github.com dan URL berkredensial", () => {
    for (const repo of [
      "https://evil.com/a/b",
      "git@github.com:a/b.git",
      "https://t:tok@github.com/a/b",
      "https://github.com/a/b/../c",
      "https://github.com/a",
      "",
    ]) {
      expect(bacaBodyConnect({ repo }).ok).toBe(false);
    }
  });

  it("menolak nama aplikasi yang bisa menyamar jadi flag atau keluar folder", () => {
    for (const nama of ["--stack", "../kabur", "Nama Besar", "a".repeat(64), ""]) {
      expect(bacaBodyConnect({ repo: "https://github.com/a/b", nama }).ok).toBe(false);
    }
  });

  it("menolak branch berkarakter shell dan stack di luar daftar", () => {
    expect(bacaBodyConnect({ repo: "https://github.com/a/b", branch: "main;rm" }).ok).toBe(false);
    expect(bacaBodyConnect({ repo: "https://github.com/a/b", stack: "cobol" }).ok).toBe(false);
  });

  it("menolak kunci body asing, bukan mengabaikannya", () => {
    expect(bacaBodyConnect({ repo: "https://github.com/a/b", path: "/etc" }).ok).toBe(false);
    expect(bacaBodyConnect(null).ok).toBe(false);
    expect(bacaBodyConnect([]).ok).toBe(false);
  });
});

describe("argvConnect", () => {
  it("menyusun argv array dengan --path dari server dan identitas dari sesi", () => {
    const baca = bacaBodyConnect({ repo: "https://github.com/a/b", stack: "go" });
    expect(baca.ok).toBe(true);
    if (!baca.ok) return;
    const args = argvConnect("/home/tugure/autore-workspace", baca.nilai, {
      nama: "Budi",
      email: "budi@example.com",
    });
    expect(args).toEqual([
      "connect",
      "--path",
      "/home/tugure/autore-workspace",
      "--repo",
      "https://github.com/a/b",
      "--app-name",
      "b",
      "--branch",
      "main",
      "--stack",
      "go",
      "--author-name",
      "Budi",
      "--author-email",
      "budi@example.com",
    ]);
  });

  it("tanpa stack, CLI yang menebak dari isi repo", () => {
    const baca = bacaBodyConnect({ repo: "https://github.com/a/b" });
    if (!baca.ok) throw new Error(baca.error);
    expect(argvConnect("/ws", baca.nilai)).not.toContain("--stack");
  });

  it("URL repo dari output connect bisa dibaca dashboard", () => {
    expect(repoDariOutput("  • Repo GitHub    tugure-reasuransi/autore-demo (tersambung)")).toBe(
      "https://github.com/tugure-reasuransi/autore-demo",
    );
  });
});
