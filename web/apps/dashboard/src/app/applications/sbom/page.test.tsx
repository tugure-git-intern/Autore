import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SbomPayload } from "@/lib/contracts";

let params = new URLSearchParams("app=tes-web");

vi.mock("next/navigation", () => ({
  usePathname: () => "/applications/sbom",
  useSearchParams: () => params,
}));

import SbomPage from "./page";

afterEach(() => {
  params = new URLSearchParams("app=tes-web");
  vi.unstubAllGlobals();
});

const PAYLOAD: SbomPayload = {
  app: "tes-web",
  generated_at: "2026-11-05T08:27:11Z",
  source: "/home/tugure/autore-workspace/tes-web/dist/sbom.cdx.json",
  total: 2,
  packages: [
    { name: "openssl", version: "3.0.11", type: "os" },
    { name: "express", version: "4.18.2", type: "language" },
  ],
};

function mockFetch(response: { status: number; body: unknown }) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body,
  }));
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

const renderPage = () => render(<SbomPage />);

describe("halaman SBOM", () => {
  it("memuat SBOM aplikasi dari URL dan menampilkan tabelnya", async () => {
    const fetchMock = mockFetch({ status: 200, body: PAYLOAD });

    renderPage();

    expect(await screen.findByText("SBOM — tes-web")).toBeVisible();
    expect(screen.getByText(/2 paket · dibuat/)).toBeVisible();
    expect(screen.getByRole("row", { name: /openssl/ })).toBeVisible();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sbom/tes-web");
  });

  it("menyediakan jalan kembali ke detail aplikasi", async () => {
    mockFetch({ status: 200, body: PAYLOAD });

    renderPage();

    const kembali = await screen.findByRole("link", { name: /Kembali ke Detail Aplikasi/ });
    expect(kembali.getAttribute("href")).toBe("/applications");
  });

  it("menjelaskan saat SBOM belum ada, bukan menampilkan tabel kosong", async () => {
    mockFetch({ status: 404, body: { error: "SBOM belum ada untuk `tes-web`" } });

    renderPage();

    expect(await screen.findByText("SBOM belum tersedia untuk aplikasi ini.")).toBeVisible();
    expect(screen.getByText(/tahap 6/)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("menampilkan alert dan bisa mencoba lagi saat server gagal", async () => {
    const fetchMock = mockFetch({ status: 500, body: { error: "boom" } });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Gagal memuat SBOM.");

    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
  });

  it("meminta id aplikasi kalau URL tidak menyebutkannya", async () => {
    params = new URLSearchParams("");
    const fetchMock = mockFetch({ status: 200, body: PAYLOAD });

    renderPage();

    expect(await screen.findByText("Aplikasi tidak disebutkan.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
