import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ActivePipeline, ApplicationRecord, DashboardStatus, RunRecord } from "@/lib/contracts";
import { AppDetail } from "./app-detail";

const app: ApplicationRecord = {
  id: "portal-klaim",
  name: "Portal Klaim",
  status: "failed",
  last_build: "2026-11-03T10:00:00Z",
  commit_sha: "aaaaaaa1",
  security_issues: 1,
  author: "MAliffadlan <maliffadlan@users.noreply.github.com>",
  deployed: true,
};

type Pipeline = DashboardStatus["latest_pipeline"];

const pipelineMilikAppLain: Pipeline = {
  status: "passed",
  failure_reason: "",
  stages: ["checkout", "scan", "build"],
  security_summary: "Tidak ada temuan keamanan.",
  commit_sha: "bbbbbbb9",
  author: "Orang Lain",
  raw_log: ["Pipeline selesai tanpa error."],
};

const pipelineCocok: Pipeline = { ...pipelineMilikAppLain, commit_sha: "aaaaaaa1" };

const run = (ubah: Partial<RunRecord> = {}): RunRecord => ({
  app: "portal-klaim",
  number: 12,
  status: "passed",
  duration_ms: 42_000,
  started_at: "2026-11-03T10:00:00Z",
  commit_sha: "aaaaaaa1",
  author: "MAliffadlan",
  url: "https://jenkins.local:8080/job/portal-klaim/12/",
  ...ubah,
});

const aktif = (ubah: Partial<ActivePipeline> = {}): ActivePipeline => ({
  app: "portal-klaim",
  number: 0,
  status: "queued",
  branch: "main",
  commit_sha: "aaaaaaa1",
  author: "MAliffadlan",
  started_at: "2026-11-03T10:00:00Z",
  url: "https://jenkins.local:8080/job/portal-klaim/",
  ...ubah,
});

const gambar = (ubah: Partial<Parameters<typeof AppDetail>[0]> = {}) =>
  render(
    <AppDetail
      app={app}
      pipeline={pipelineMilikAppLain}
      runs={[]}
      aktif={[]}
      applications={[app]}
      {...ubah}
    />,
  );

test("menampilkan fakta per aplikasi dan tidak mengklaim pipeline global sebagai miliknya", () => {
  const appLulus = { ...app, status: "passed" as const };
  gambar({ app: appLulus, applications: [appLulus] });

  expect(screen.getByRole("heading", { name: "Detail Pipeline" })).toBeVisible();
  expect(screen.getByText("MAliffadlan <maliffadlan@users.noreply.github.com>")).toBeVisible();
  expect(screen.getByText("1 temuan keamanan")).toBeVisible();
  expect(screen.getByText("Terpasang")).toBeVisible();
  expect(screen.getByText(/Pipeline terakhir di workspace ini bukan milik Portal Klaim/)).toBeVisible();
  expect(screen.queryByRole("list", { name: "Tahapan pipeline" })).toBeNull();
  expect(screen.queryByText("Pipeline selesai tanpa error.")).toBeNull();
});

test("memakai pipeline workspace begitu commit-nya cocok dengan aplikasi", () => {
  const appLulus = { ...app, status: "passed" as const };
  gambar({ app: appLulus, applications: [appLulus], pipeline: pipelineCocok });

  expect(screen.getByRole("list", { name: "Tahapan pipeline" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Detail Log" })).toBeVisible();
  expect(screen.queryByText(/bukan milik Portal Klaim/)).toBeNull();
});

test("aplikasi gagal tidak pernah menampilkan timeline hijau milik aplikasi lain", () => {
  const dummy = { ...app, id: "autore-dummy", name: "autore-dummy", status: "passed" as const };
  gambar({
    applications: [app, dummy],
    pipeline: pipelineCocok,
    runs: [run({ number: 13, status: "failed", url: "https://jenkins.local:8080/job/portal-klaim/13/" })],
  });

  const kartu = screen.getByTestId("detail-gagal");
  expect(within(kartu).getByText("Pipeline gagal, cek log Jenkins.")).toBeVisible();
  expect(screen.queryByRole("list", { name: "Tahapan pipeline" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Detail Log" })).toBeNull();
  expect(screen.queryByText("Pipeline selesai tanpa error.")).toBeNull();
  expect(within(kartu).getByRole("link", { name: /Buka log build #13/ })).toHaveAttribute(
    "href",
    "https://jenkins.local:8080/job/portal-klaim/13/",
  );
});

test("riwayat build hanya memuat aplikasi terpilih, dengan link Jenkins per build", () => {
  gambar({
    runs: [
      run({ number: 12 }),
      run({ app: "app-lain", number: 7, url: "https://jenkins.local:8080/job/app-lain/7/" }),
      run({ number: 11, started_at: "2026-11-02T10:00:00Z" }),
    ],
  });

  const riwayat = screen.getByRole("list", { name: "Riwayat build aplikasi ini" });
  const baris = within(riwayat).getAllByTestId("detail-run-row");
  expect(baris).toHaveLength(2);
  expect(baris[0]).toHaveTextContent("#12");
  expect(baris[0]).toHaveTextContent("42.0s");
  expect(within(riwayat).getByRole("link", { name: /#12/ })).toHaveAttribute(
    "href",
    "https://jenkins.local:8080/job/portal-klaim/12/",
  );
  expect(within(riwayat).queryByText(/app-lain/)).toBeNull();
});

test("mengabsen jujur saat aplikasi belum pernah dibangun", () => {
  gambar();

  expect(screen.getByText("Belum ada run untuk aplikasi ini")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Jenkins/ })).toBeNull();
});

test("menampilkan status berjalan/menunggu hanya untuk aplikasi ini", () => {
  gambar({ aktif: [aktif({ status: "queued" }), aktif({ app: "app-lain", status: "running" })] });

  const strip = screen.getByTestId("detail-aktif");
  expect(within(strip).getByText("Menunggu")).toBeVisible();
  expect(within(strip).getByText("Sedang menunggu di antrean Jenkins")).toBeVisible();
  expect(within(strip).queryByText("Berjalan")).toBeNull();
});

test("meneruskan aksi kembali ke daftar untuk layar sempit", () => {
  const onDaftar = vi.fn();
  gambar({ onDaftar });

  fireEvent.click(screen.getByRole("button", { name: /Daftar aplikasi/ }));

  expect(onDaftar).toHaveBeenCalled();
});
