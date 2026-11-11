import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Shell membaca pathname App Router; komponen nyata di bawah ini memakai
// komponen halaman sungguhan (DashboardPage -> DashboardOverview -> tabel aplikasi).
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import type { ApiStatusResponse, RunsPayload, ActivePayload } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { AppShell } from "@/components/app-shell";
import DashboardPage from "@/app/page";

const USER: SessionUser = { login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" };

const STATUS: ApiStatusResponse = {
  data: {
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 1, running_containers: 1 },
    repository_health: { score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9 },
    applications: [
      {
        id: "tes-web",
        name: "tes-web",
        status: "unknown",
        last_build: "",
        commit_sha: "",
        security_issues: 0,
      },
    ],
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

const RUNS: RunsPayload = {
  generated_at: "2026-11-05T03:40:00Z",
  window_days: 7,
  runs: [],
  daily: [],
  totals: { passed: 0, failed: 0, running: 0 },
};

const ACTIVE: ActivePayload = {
  generated_at: "2026-11-05T03:40:00Z",
  active: [],
  counts: { running: 0, queued: 0 },
};

const response = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function renderShell() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/status") return response(STATUS);
      if (url === "/api/runs") return response({ data: RUNS, stale: false });
      if (url === "/api/active") return response({ data: ACTIVE, stale: false });
      throw new Error(`permintaan tidak terduga: ${url}`);
    }),
  );
  return render(
    <AppShell user={USER}>
      <DashboardPage />
    </AppShell>,
  );
}

const main = () => document.querySelector("main")!;

afterEach(() => {
  nav.pathname = "/";
  vi.unstubAllGlobals();
});

describe("AppShell — sidebar buka/tutup konten", () => {
  it("mulai terbuka dengan konten menjorok 274px", () => {
    renderShell();
    expect(main().className).toContain("lg:ml-[274px]");
    expect(screen.getByRole("button", { name: "Tutup sidebar" })).toHaveAttribute("aria-expanded", "true");
  });

  it("menutup sidebar melepaskan konten ke tepi kiri (12px)", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByRole("link", { name: "Detail" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Tutup sidebar" }));

    expect(main().className).toContain("lg:ml-3");
    expect(main().className).not.toContain("lg:ml-[274px]");
    expect(screen.getByRole("button", { name: "Buka sidebar" })).toHaveAttribute("aria-expanded", "false");
  });

  it("status tutup bertahan saat berpindah halaman di dalam konten", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByRole("link", { name: "Detail" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Tutup sidebar" }));
    expect(main().className).toContain("lg:ml-3");

    nav.pathname = "/pipeline";
    // Komponenten shell tetap sama (layout), hanya pathname-nya yang berubah.
    expect(main().className).toContain("lg:ml-3");
    expect(main().className).not.toContain("lg:ml-[274px]");
  });

  it("tombol memakai ikon hamburger Menu (tiga garis), bukan PanelLeft", () => {
    renderShell();

    const btn = screen.getByRole("button", { name: "Tutup sidebar" });
    expect(btn.querySelector("svg.lucide-menu")).not.toBeNull();
    expect(btn.querySelector("svg.lucide-panel-left")).toBeNull();
  });

  it("hamburger duduk di grup kiri topbar, bersebelahan dengan tagline dan tidak absolut", () => {
    renderShell();

    // Posisi diatur padding baris (274px saat terbuka), bukan absolute left-3.
    const btn = screen.getByRole("button", { name: "Tutup sidebar" });
    expect(btn.className).not.toContain("absolute");
    expect(btn.className).not.toContain("left-3");
    expect(btn.parentElement?.firstElementChild).toBe(btn);
    // Grup itu hanya [tombol][tagline]; tidak ada judul jalur yang menyusul.
    expect(btn.parentElement?.children).toHaveLength(2);
    expect(btn.nextElementSibling).toBe(screen.getByTestId("topbar-tagline"));
  });

  it("tagline duduk di grup topbar, tepat setelah tombol hamburger", () => {
    renderShell();

    const btn = screen.getByRole("button", { name: "Tutup sidebar" });
    const tagline = screen.getByTestId("topbar-tagline");
    expect(tagline.textContent).toBe("Automation Tugure");

    // Satu grup dengan tombol, tombol lebih dulu, tagline langsung sesudahnya.
    expect(tagline.parentElement).toBe(btn.parentElement);
    expect(btn.nextElementSibling).toBe(tagline);
    expect(tagline.parentElement?.className).toContain("flex items-center gap-2");

    // Tipografi: 11px, warna bertema, tanpa kelas font lain yang menimpa
    // Google Sans Flex global dari globals.css.
    expect(tagline.className).toContain("text-sm");
    expect(tagline.className).toContain("leading-tight");
    expect(tagline.className).toContain("text-muted");
    expect(tagline.className).toContain("dark:text-[#c9d1d9]");
    expect(tagline.className).not.toContain("tracking-tight");
    // Bobot sama dengan label tombol Sync di topbar.
    expect(tagline.className).toContain("font-medium");
    expect(tagline.className).not.toMatch(/font-(sans|serif|mono)\b/);

    // Ikut nasib tombolnya: desktop saja.
    expect(tagline.className).toContain("hidden");
    expect(tagline.className).toContain("lg:inline-block");
  });

  it("kepala sidebar bersih: hanya logo, Autore, dan CI/CD Workspace", () => {
    renderShell();

    const merek = screen.getByTestId("sidebar-brand");
    const logo = screen.getByRole("img", { name: "Tugu Reasuransi" });
    const autore = screen.getByText("Autore");
    const cicd = screen.getByText("CI/CD Workspace");

    // Satu baris, logo di depan kolom teks, tanpa elemen di sisi kanan.
    expect(merek.className).toContain("flex");
    expect(merek.className).toContain("items-center");
    expect(merek.className).toContain("gap-3");
    expect(merek.firstElementChild).toBe(logo);

    // Autore dan CI/CD Workspace tetap satu kolom vertikal.
    expect(cicd.parentElement).toBe(autore.parentElement);

    // Tagline sudah pindah ke topbar: bukan bagian blok merek lagi.
    expect(merek.contains(screen.getByTestId("topbar-tagline"))).toBe(false);
  });
});
