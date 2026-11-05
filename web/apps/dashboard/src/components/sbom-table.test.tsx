import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SbomPayload } from "@/lib/contracts";
import { SbomTable } from "./sbom-table";

const PAYLOAD: SbomPayload = {
  app: "tes-web",
  generated_at: "2026-11-05T08:27:11Z",
  source: "/home/tugure/autore-workspace/tes-web/dist/sbom.cdx.json",
  total: 3,
  packages: [
    { name: "openssl", version: "3.0.11", type: "os" },
    { name: "express", version: "4.18.2", type: "language" },
    { name: "tanpa-versi", version: "", type: "language" },
  ],
};

const baris = () => screen.getAllByRole("row").slice(1);

const cari = (nilai: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Cari library" }), {
    target: { value: nilai },
  });

describe("SbomTable", () => {
  it("menampilkan kolom yang diminta dengan label tipe bahasa Indonesia", () => {
    render(<SbomTable payload={PAYLOAD} />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Nama Library",
      "Versi",
      "Tipe",
    ]);
  });

  it("menerjemahkan tipe CLI jadi label yang dibaca manusia, dan versi kosong jadi strip", () => {
    render(<SbomTable payload={PAYLOAD} />);

    const cells = (nama: string) =>
      within(baris().find((row) => row.textContent?.includes(nama))!).getAllByRole("cell");

    expect(cells("openssl")[2].textContent).toBe("OS Package");
    expect(cells("express")[2].textContent).toBe("Language Package");
    expect(cells("tanpa-versi")[1].textContent).toBe("—");
  });

  it("menghitung paket yang tampil dari total, tanpa mengubah data", () => {
    render(<SbomTable payload={PAYLOAD} />);

    expect(screen.getByText("3 dari 3 paket")).toBeVisible();
    expect(baris()).toHaveLength(3);
  });

  it("kotak pencarian menyaring tabel dan memperbarui hitungannya", () => {
    render(<SbomTable payload={PAYLOAD} />);

    cari("OPENSSL");

    expect(baris()).toHaveLength(1);
    expect(screen.getByText("1 dari 3 paket")).toBeVisible();
    expect(screen.queryByText("express")).toBeNull();
  });

  it("menampilkan pesan kosong saat pencarian tidak menemukan apa pun", () => {
    render(<SbomTable payload={PAYLOAD} />);

    cari("zzz");

    expect(screen.getByText("Tidak ada library yang cocok")).toBeVisible();
    expect(screen.getByText("0 dari 3 paket")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tahan pada SBOM kosong: menjelaskan, bukan menampilkan tabel kosong", () => {
    render(<SbomTable payload={{ ...PAYLOAD, total: 0, packages: [] }} />);

    expect(screen.getByText("SBOM ini tidak memuat paket")).toBeVisible();
    expect(screen.getByText("0 dari 0 paket")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
