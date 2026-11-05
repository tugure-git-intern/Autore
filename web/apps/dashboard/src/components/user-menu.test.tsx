import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, vi } from "vitest";

// `signOut` adalah satu-satunya jalur keluar; kalau tes ini lewat, keluar
// benar-benar dipegang Auth.js dan tidak ada state login lokal yang perlu dibersihkan.
const signOut = vi.hoisted(() => vi.fn());
vi.mock("next-auth/react", () => ({ signOut }));

import { UserMenu } from "./user-menu";

// jsdom menganggap isi <details> yang tertutup tidak terlihat; buka dulu supaya
// assertion-nya bicara soal isi menu, bukan soal status buka/tutup.
function tampilkan(user: { login: string; name: string; image: string | null }) {
  const hasil = render(<UserMenu user={user} />);
  const details = hasil.container.querySelector("details");
  if (details) details.open = true;
  return hasil;
}

beforeEach(() => {
  signOut.mockReset();
});

describe("UserMenu", () => {
  it("menampilkan avatar dengan alt berupa login github", () => {
    tampilkan({ login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" });

    const avatar = screen.getByAltText("tugure-git-intern") as HTMLImageElement;
    expect(avatar.tagName).toBe("IMG");
    expect(avatar.getAttribute("src")).toBe("https://x/a.png");
  });

  it("menampilkan nama tampilan dan login-nya", () => {
    tampilkan({ login: "tugure-git-intern", name: "Alif", image: null });

    expect(screen.getByText("Alif")).toBeVisible();
    expect(screen.getByText("@tugure-git-intern")).toBeVisible();
  });

  it("jatuh ke inisial saat github tidak mengirim avatar", () => {
    tampilkan({ login: "alif", name: "Alif", image: null });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AL")).toBeVisible();
  });

  it("keluar lewat Auth.js dan kembali ke /login", () => {
    tampilkan({ login: "alif", name: "Alif", image: null });

    fireEvent.click(screen.getByRole("button", { name: /keluar/i }));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });

  it("menampilkan login github apa adanya, bukan versi huruf kecil", () => {
    tampilkan({ login: "MAliffadlan", name: "", image: null });

    // Label jatuh ke login saat nama tampilan kosong: casing GitHub yang tampil.
    expect(screen.getByText("MAliffadlan")).toBeVisible();
    expect(screen.getByText("@MAliffadlan")).toBeVisible();
    expect(screen.queryByText("@maliffadlan")).toBeNull();
  });

  it("tidak pernah menampilkan input kata sandi", () => {
    tampilkan({ login: "alif", name: "Alif", image: null });

    expect(screen.queryByLabelText(/sandi|password/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
