import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BahasaProvider, useBahasa } from "./bahasa-provider";
import { PemilihBahasa } from "./pemilih-bahasa";

/** Saksi: membuktikan pergantian bahasa sampai ke konsumen `useBahasa`. */
function Saksi() {
  const { bahasa, t } = useBahasa();
  return (
    <p data-testid="saksi">
      {bahasa}:{t("menu.bahasa")}
    </p>
  );
}

const renderPemilih = (awal: "id" | "en" = "id", terbuka = true) =>
  render(
    <BahasaProvider awal={awal}>
      <Saksi />
      <PemilihBahasa terbuka={terbuka} onTutup={() => {}} />
    </BahasaProvider>,
  );

const dialog = () => screen.getByRole("dialog", { hidden: true });

beforeEach(() => {
  document.documentElement.lang = "id";
  document.cookie = "autore-bahasa=; path=/; max-age=0";
});

afterEach(() => {
  document.documentElement.lang = "";
});

describe("PemilihBahasa", () => {
  it("tertutup secara bawaan: dialog ada di DOM tapi tanpa atribut open", () => {
    renderPemilih("id", false);
    expect(dialog()).not.toHaveAttribute("open");
    expect(screen.queryByRole("heading", { name: "Pilih Bahasa" })).toBeNull();
  });

  it("memuat dua kartu radio dengan gambar bendera masing-masing", () => {
    renderPemilih();
    expect(dialog()).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Pilih Bahasa" })).toBeVisible();

    const indonesia = screen.getByRole("radio", { name: /Indonesia/ });
    const inggris = screen.getByRole("radio", { name: /Inggris/ });

    expect(indonesia.querySelector("[data-testid='bendera-id']")).not.toBeNull();
    expect(inggris.querySelector("[data-testid='bendera-en']")).not.toBeNull();
    expect(screen.getByRole("radiogroup")).toBeVisible();
  });

  it("bahasa aktif ditandai aria-checked, bukan warna saja", () => {
    renderPemilih("en");
    expect(screen.getByRole("radio", { name: /English/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Indonesian/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("klik Inggris: bahasa, <html lang>, cookie, dan konsumen ikut berubah", () => {
    renderPemilih("id");
    expect(screen.getByTestId("saksi")).toHaveTextContent("id:Bahasa");

    fireEvent.click(screen.getByRole("radio", { name: /Inggris/ }));

    // Konsumen langsung ikut: label menu jadi "Language", kartu ikut terpilih.
    expect(screen.getByTestId("saksi")).toHaveTextContent("en:Language");
    expect(screen.getByRole("radio", { name: /English/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Server membaca cookie ini di layout, jadi pilihan bertahan setelah reload.
    expect(document.cookie).toContain("autore-bahasa=en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("klik Indonesia mengembalikan teks dan lang ke id", () => {
    renderPemilih("en");
    fireEvent.click(screen.getByRole("radio", { name: /Indonesian/ }));

    expect(screen.getByTestId("saksi")).toHaveTextContent("id:Bahasa");
    expect(document.cookie).toContain("autore-bahasa=id");
    expect(document.documentElement.lang).toBe("id");
  });

  it("judul modal ikut bahasa aktif", () => {
    renderPemilih("en");
    expect(screen.getByRole("heading", { name: "Choose Language" })).toBeVisible();
  });
});