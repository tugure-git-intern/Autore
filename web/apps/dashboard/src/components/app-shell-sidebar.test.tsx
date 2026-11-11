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

  it("hamburger duduk di grup kiri topbar, sebelum breadcrumb dan tidak absolut", () => {
    renderShell();

    // Posisi diatur padding baris (274px saat terbuka), bukan absolute left-3.
    const btn = screen.getByRole("button", { name: "Tutup sidebar" });
    expect(btn.className).not.toContain("absolute");
    expect(btn.className).not.toContain("left-3");
    expect(btn.parentElement?.firstElementChild).toBe(btn);
  });

  it("blok merek sidebar kembali memakai padding simetris, tanpa jalur tombol", () => {
    renderShell();

    const merek = screen.getByTestId("sidebar-brand");
    expect(merek.className).toContain("px-6");
    expect(merek.className).not.toContain("pl-12");

    const tagline = screen.getByText("Automation Tugure");
    expect(tagline.className).toContain("text-[10px]");
    expect(tagline.className).toContain("text-muted");
    // Tagline lama tetap ada: yang diminta hanya menambah baris baru.
    expect(screen.getByText("CI/CD Workspace")).toBeInTheDocument();
  });
});
