import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Shell membaca pathname App Router; rute ini yang dipakai tes.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import type { ActivePayload, ApiStatusResponse, RunsPayload } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { AppShell } from "./app-shell";
import { useKirimToast } from "./toast";

const USER: SessionUser = { login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" };

const STATUS: ApiStatusResponse = {
  data: {
    system_status: "idle",
    infra: { jenkins: "active", nexus: "active" },
    stats: { total_apps: 1, running_containers: 1 },
    repository_health: { score_percent: 10, total_repos: 10, gold: 1, silver: 0, bronze: 9 },
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

/** Balasan per endpoint; `runs` bisa ditimpa untuk menguji kegagalan sebagian. */
const balas = (over: { runs?: () => Promise<Response> } = {}) =>
  vi.fn(async (url: string) => {
    if (url === "/api/status") return response(STATUS);
    if (url === "/api/runs") return over.runs ? over.runs() : response({ data: RUNS, stale: false });
    if (url === "/api/active") return response({ data: ACTIVE, stale: false });
    throw new Error(`permintaan tidak terduga: ${url}`);
  });

const jalur = (fetchMock: ReturnType<typeof vi.fn>) =>
  new Set(fetchMock.mock.calls.map((c) => c[0] as string));

afterEach(() => {
  nav.pathname = "/";
  vi.unstubAllGlobals();
});

describe("AppShell — tombol Sync", () => {
  it("menarik status, runs dan active sekaligus lalu menampilkan toast sukses", async () => {
    const fetchMock = balas();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );

    // Tiga sumber sudah ditarik saat mount — bukan cuma /api/status.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(jalur(fetchMock)).toEqual(new Set(["/api/status", "/api/runs", "/api/active"]));

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    for (const url of ["/api/status", "/api/runs", "/api/active"]) {
      expect(fetchMock.mock.calls.filter((c) => c[0] === url)).toHaveLength(2);
    }

    expect(await screen.findByText("Data berhasil disinkronkan.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync" })).toBeEnabled();
  });

  it("toast gagal kalau satu endpoint menolak, dan tombol kembali aktif", async () => {
    const fetchMock = balas({
      runs: async () => {
        throw new Error("runs mati");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(await screen.findByText("Gagal menyinkronkan data.")).toBeVisible();
    expect(screen.queryByText("Data berhasil disinkronkan.")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync" })).toBeEnabled());
  });

  it("klik beruntun saat sync berjalan tidak menambah permintaan", async () => {
    // Fase 1 (mount) dibalas seketika supaya tidak ada permintaan menggantung;
    // fase 2 ditahan agar Sync benar-benar terlihat sedang berjalan.
    let tahan = false;
    const lepas: (() => void)[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const body =
        url === "/api/status"
          ? STATUS
          : url === "/api/runs"
            ? { data: RUNS, stale: false }
            : { data: ACTIVE, stale: false };
      if (tahan) await new Promise<void>((r) => lepas.push(r));
      return response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    tahan = true;
    const tombol = screen.getByRole("button", { name: "Sync" });
    fireEvent.click(tombol);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    fireEvent.click(tombol);
    fireEvent.click(tombol);

    expect(fetchMock).toHaveBeenCalledTimes(6);

    await act(async () => {
      lepas.forEach((r) => r());
    });
  });
});

describe("AppShell — notifikasi global", () => {
  it("pesan dari komponen anak muncul sebagai toast yang melayang, bukan di dalam tabel", async () => {
    vi.stubGlobal("fetch", balas());

    function PemakaiToast() {
      const kirim = useKirimToast();
      return (
        <table>
          <tbody>
            <tr>
              <td>
                <button type="button" onClick={() => kirim("Scan keamanan selesai tanpa temuan.", "sukses")}>
                  Scan Keamanan
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      );
    }

    render(
      <AppShell user={USER}>
        <PemakaiToast />
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan Keamanan" }));

    const toast = await screen.findByTestId("toast");
    expect(toast).toHaveTextContent("Scan keamanan selesai tanpa temuan.");
    // Toast hidup di luar kerangka halaman, jadi tidak ada bagian tabel yang rusak.
    expect(screen.getByRole("button", { name: "Scan Keamanan" }).closest("td")?.textContent).toBe(
      "Scan Keamanan",
    );
  });

  it("kegagalan aksi memakai toast merah (role alert)", async () => {
    vi.stubGlobal("fetch", balas());

    function PemakaiToast() {
      const kirim = useKirimToast();
      return (
        <button type="button" onClick={() => kirim("Gagal menyinkronkan data.", "gagal")}>
          Kirim
        </button>
      );
    }

    render(
      <AppShell user={USER}>
        <PemakaiToast />
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kirim" }));

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("Gagal menyinkronkan data.");
    expect(toast.className).toContain("motion-safe:animate-");
  });
});
