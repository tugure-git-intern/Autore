import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardStatus } from "@/lib/contracts";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

import PipelinePage from "./page";

const app = {
  id: "app-portal-klaim",
  name: "Portal Klaim",
  status: "passed" as const,
  last_build: "2026-11-03T10:00:00Z",
  commit_sha: "a1b2c3d4e5f6",
  security_issues: 0,
};

const base: DashboardStatus = {
  system_status: "idle",
  infra: { jenkins: "active", nexus: "active" },
  stats: { total_apps: 1, running_containers: 0 },
  applications: [app],
  latest_pipeline: {
    status: "failed",
    failure_reason: "Gitleaks menemukan rahasia.",
    stages: ["checkout", "scan", "build"],
    security_summary: "3 temuan pada 2 file",
    commit_sha: "a1b2c3d4e5f6",
    author: "tugure",
    raw_log: ["raw CLI output line", "second line"],
  },
};

function mockStatus(data: DashboardStatus, stale = false) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data, stale }),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  nav.params = new URLSearchParams();
});

describe("PipelinePage", () => {
  it("renders the failure reason as an alert before the stage timeline", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus(base);

    render(<PipelinePage />);

    const alert = await screen.findByText("Gitleaks menemukan rahasia.");
    expect(alert).toHaveAttribute("role", "alert");
    const timeline = screen.getByRole("list", { name: "Tahapan pipeline" });
    expect(alert.compareDocumentPosition(timeline)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("3 temuan pada 2 file")).toBeVisible();
  });

  it("marks the last recorded stage as failed and leaves unrun stages neutral", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus(base);

    render(<PipelinePage />);

    const rows = await screen.findAllByRole("listitem");
    const byLabel = (label: string) => rows.find((row) => row.textContent?.startsWith(label));
    expect(byLabel("Checkout")?.textContent).toContain("selesai");
    expect(byLabel("Security Scan")?.textContent).toContain("selesai");
    expect(byLabel("Build")?.textContent).toContain("gagal");
    expect(byLabel("Push")?.textContent).toContain("Belum dijalankan");
    expect(byLabel("Deploy")?.textContent).toContain("Belum dijalankan");
  });

  it("appends unknown stage ids after canonical stages without guessing", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus({
      ...base,
      latest_pipeline: { ...base.latest_pipeline, status: "running", stages: ["checkout", "lint"] },
    });

    render(<PipelinePage />);

    const rows = await screen.findAllByRole("listitem");
    expect(rows.at(-1)?.textContent).toContain("lint");
    expect(rows.at(-1)?.textContent).toContain("berjalan");
    expect(rows).toHaveLength(6);
  });

  it("shows the exact empty pipeline copy when nothing ran", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus({
      ...base,
      latest_pipeline: {
        ...base.latest_pipeline,
        status: "idle",
        stages: [],
        failure_reason: "",
        raw_log: [],
      },
    });

    render(<PipelinePage />);

    expect(await screen.findByText("Tidak ada data pipeline untuk ditampilkan.")).toBeVisible();
  });

  it("falls back to the neutral security copy when the CLI supplied no summary", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus({
      ...base,
      latest_pipeline: { ...base.latest_pipeline, security_summary: "" },
    });

    render(<PipelinePage />);

    expect(await screen.findByText("Belum ada hasil scan")).toBeVisible();
  });

  it("opens the log modal with raw CLI lines, closes on Escape and returns focus", async () => {
    nav.params = new URLSearchParams("app=app-portal-klaim");
    mockStatus(base);

    render(<PipelinePage />);

    const trigger = await screen.findByRole("button", { name: "Lihat Log Lengkap" });
    expect(screen.queryByRole("dialog")).toBeNull();

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("raw CLI output line")).toBeVisible();
    expect(within(dialog).getByText("second line")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("shows neutral unavailable copy for an unknown app id", async () => {
    nav.params = new URLSearchParams("app=tidak-ada");
    mockStatus(base);

    render(<PipelinePage />);

    expect(await screen.findByText(/tidak ditemukan/i)).toBeVisible();
    expect(screen.queryByRole("list", { name: "Tahapan pipeline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lihat Log Lengkap" })).toBeNull();
  });

  it("renders CLI text as React text nodes, never dangerouslySetInnerHTML", () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/^\/@fs/, "");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (readFileSync(full, "utf8").includes("dangerouslySetInnerHTML")) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});