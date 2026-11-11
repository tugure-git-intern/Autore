import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiStatusResponse } from "@/lib/contracts";

const nav = vi.hoisted(() => ({ pathname: "/pipeline" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { StatusProvider } from "./app-shell";
import { Sidebar, indikatorServer, versiAutore } from "./sidebar";

const STATUS: ApiStatusResponse = {
  data: {
    system_status: "passed",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 1, running_containers: 1 },
    repository_health: { score_percent: 100, total_repos: 1, gold: 1, silver: 0, bronze: 0 },
    applications: [],
    latest_pipeline: {
      status: "idle",
      failure_reason: "",
      stages: [],
      security_summary: "",
      commit_sha: "",
      author: "",
      raw_log: [],
    },
  },
  stale: false,
};

const SEGAR: ApiStatusResponse = { ...STATUS, stale: false };
const BASI: ApiStatusResponse = { ...STATUS, stale: true };

const balas = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

/**
 * `/api/status` dijawab sesuai skenario; `/api/runs` & `/api/active` dibiarkan
 * menggantung selamanya supaya tes footer murni menguji jalur status.
 */
const pasangFetch = (status: ApiStatusResponse | Error) => {
  const fn = vi.fn(async (url: string) => {
    if (url === "/api/status") {
      if (status instanceof Error) throw status;
      return balas(status);
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

const renderSidebar = (status: ApiStatusResponse | Error = SEGAR) => {
  pasangFetch(status);
  return render(
    <StatusProvider>
      <Sidebar terbuka />
    </StatusProvider>,
  );
};

/** Footer status butuh satu microtask sebelum provider memasang hasil tarikan. */
const tungguStatus = async (teks: string) => {
  await waitFor(() => expect(screen.getByText(teks)).toBeTruthy());
};

describe("indikatorServer", () => {
  it("hijau saat status segar dan tidak ada kegagalan", () => {
    expect(indikatorServer({ state: SEGAR, failed: false, loading: false })).toEqual({
      tone: "green",
      label: "Server Online",
      pulse: true,
    });
  });

  it("merah saat snapshot basi walau API menjawab", () => {
    expect(indikatorServer({ state: BASI, failed: false, loading: false })).toEqual({
      tone: "red",
      label: "Server Offline",
      pulse: false,
    });
  });

  it("merah saat tarikan API gagal", () => {
    expect(indikatorServer({ state: null, failed: true, loading: false })).toEqual({
      tone: "red",
      label: "Server Offline",
      pulse: false,
    });
  });

  it("netral selama tarikan pertama belum selesai", () => {
    expect(indikatorServer({ state: null, failed: false, loading: true })).toEqual({
      tone: "neutral",
      label: "Memuat status",
      pulse: true,
    });
  });

  it("netral saat tarikan selesai tanpa data dan gagal", () => {
    expect(indikatorServer({ state: null, failed: false, loading: false })).toEqual({
      tone: "neutral",
      label: "Status belum tersedia",
      pulse: false,
    });
  });
});

describe("versiAutore", () => {
  const asli = process.env.NEXT_PUBLIC_APP_VERSION;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  afterEach(() => {
    if (asli === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
    else process.env.NEXT_PUBLIC_APP_VERSION = asli;
  });

  it("memakai NEXT_PUBLIC_APP_VERSION saat build menyuntiknya", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v9.9.9";
    expect(versiAutore()).toBe("v9.9.9");
  });

  it("jatuh ke v0.6.1 saat env kosong (sinkron cli/Cargo.toml)", () => {
    expect(versiAutore()).toBe("v0.6.1");
  });
});

describe("Sidebar", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("menaruh logo Tugu Reasuransi di samping nama Autore", () => {
    renderSidebar();

    const logo = screen.getByRole("img", { name: "Tugu Reasuransi" });
    expect(logo).toHaveAttribute("src", "/tugure-logo-asli.png");
    expect(logo.className).toContain("h-10");
    expect(logo.className).toContain("w-auto");
    // object-contain + shrink-0: ikon tidak boleh dipotong atau digencet flex.
    expect(logo.className).toContain("object-contain");
    expect(logo.className).toContain("shrink-0");
    expect(screen.getByTestId("sidebar-brand").className).toContain("items-center gap-3");
    // Garis abu-abu di bawah logo dihapus agar tidak terputus di tengah jalan
    // saat menu dan navbar terpisah oleh celah 12px.
    expect(screen.getByTestId("sidebar-brand").className).not.toContain("border");
    expect(screen.getByTestId("sidebar-brand").className).not.toContain("border-b");
    expect(screen.getByText("Autore")).toBeTruthy();
  });

  it("tetap menandai rute yang sedang dibuka", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /pipeline/i })).toHaveAttribute("aria-current", "page");
  });

  it("merender menu Audit Log di bawah Keamanan", () => {
    renderSidebar();
    const auditLink = screen.getByRole("link", { name: /audit log/i });
    expect(auditLink).toHaveAttribute("href", "/audit");
  });

  it("berbentuk kartu melayang tanpa sekat: renggang dari tepi, sudut melengkung penuh", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside") as HTMLElement;

    // Keluar dari alur flex dan menempel 12px dari tepi kiri/atas/bawah viewport,
    // jadi topbar di belakangnya bisa membentang penuh tanpa terputus.
    expect(aside.className).toContain("fixed");
    expect(aside.className).toContain("left-3");
    expect(aside.className).toContain("top-3");
    expect(aside.className).toContain("bottom-3");
    expect(aside.className).not.toContain("sticky");
    expect(aside.className).not.toContain("h-screen");
    // Menumpuk di atas topbar (z-10).
    expect(aside.className).toContain("z-20");
    // Sudut melengkung di keempat sisi, bukan cuma sisi kanan.
    expect(aside.className).toContain("rounded-2xl");
    expect(aside.className).not.toContain("rounded-br-");
    expect(aside.className).not.toContain("rounded-r-");
    expect(aside.className).not.toContain("rounded-l");
    // Nyatu penuh dengan chrome: bidang sama dengan latar utama #F0F5FE, tanpa
    // border dan tanpa bayangan, supaya tidak ada gradasi tepi yang terbaca
    // sebagai sekat antara sidebar dan area konten.
    expect(aside.className).toContain("bg-[#F0F5FE]");
    expect(aside.className).not.toContain("bg-white");
    expect(aside.className).not.toContain("border");
    expect(aside.className).not.toContain("shadow");
  });

  it("mewarnai menu non-aktif #545F72 dan membiarkan menu aktif tetap hijau", () => {
    renderSidebar();

    const aktif = screen.getByRole("link", { name: /pipeline/i });
    expect(aktif.className).toContain("text-green-700");
    // Latar sidebar kini chrome #F0F5FE; pil green-50 nyaris hilang di atasnya,
    // jadi penanda menu aktif naik satu tingkat ke green-100.
    expect(aktif.className).toContain("bg-green-100");
    expect(aktif.className).not.toContain("bg-green-50");

    const nonAktif = screen.getByRole("link", { name: /daftar aplikasi/i });
    expect(nonAktif.className).toContain("text-[#545F72]");
    expect(nonAktif.className).not.toContain("text-muted");
  });

  it("mendukung palet dark mode #282c32 untuk latar sidebar dan #ffffff untuk teks non-aktif", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).toContain("bg-[#F0F5FE]");
    expect(aside.className).toContain("dark:bg-[#282c32]");

    const nonAktif = screen.getByRole("link", { name: /daftar aplikasi/i });
    expect(nonAktif.className).toContain("dark:text-white");
    expect(nonAktif.className).toContain("dark:hover:bg-[#353b43]");
  });

  it("menjaga bentuk footer status di pojok bawah", () => {
    renderSidebar();

    const footer = screen.getByTestId("sidebar-footer");
    expect(footer.className).toContain("flex items-center justify-between");
    expect(footer.className).toContain("px-4 py-3");
    expect(footer.className).not.toContain("border");
    expect(footer.className).not.toContain("border-t");

    const versionText = screen.getByText(versiAutore());
    expect(versionText.className).toContain("text-xs");
    expect(versionText.className).toContain("font-mono");
    expect(versionText.className).toMatch(/text-gray-[56]00/);
    expect(versionText.className).toContain("dark:text-gray-400");
  });

  it("menampilkan Server Online bertitik hijau saat status segar", async () => {
    renderSidebar(SEGAR);

    await tungguStatus("Server Online");
    const dot = screen.getByTestId("server-online-dot");
    expect(dot.className).toContain("h-2.5");
    expect(dot.className).toContain("w-2.5");
    expect(dot.className).toContain("rounded-full");
    expect(dot.className).toContain("bg-green-500");
    expect(dot.className).toContain("animate-pulse");

    const statusText = screen.getByText("Server Online");
    expect(statusText.className).toContain("text-sm");
    expect(statusText.className).toContain("font-medium");
    expect(statusText.className).toContain("text-gray-900");
    expect(statusText.className).toContain("dark:text-white");
    // Satu-satunya status koneksi di UI; layar pembaca butuh role live.
    expect(screen.getByRole("status").textContent).toContain("Server Online");
  });

  it("berubah jadi Server Offline bertitik merah saat tarikan API gagal", async () => {
    renderSidebar(new Error("status request failed: 502"));

    await tungguStatus("Server Offline");
    const dot = screen.getByTestId("server-online-dot");
    expect(dot.className).toContain("bg-red-500");
    expect(dot.className).not.toContain("bg-green-500");
    expect(dot.className).not.toContain("animate-pulse");
    expect(screen.queryByText("Server Online")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Server Offline");
  });

  it("berubah jadi Server Offline saat snapshot API basi", async () => {
    renderSidebar(BASI);

    await tungguStatus("Server Offline");
    expect(screen.getByTestId("server-online-dot").className).toContain("bg-red-500");
  });

});
