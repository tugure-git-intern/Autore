import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// AppShell renders the sidebar, which reads the App Router pathname. Mutable so
// each test can stand on a different route.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import type { ApiStatusResponse } from "@/lib/contracts";
import type { SessionUser } from "@/lib/current-user";
import { AppShell } from "./app-shell";
import { Navbar } from "./navbar";

const USER: SessionUser = { login: "tugure-git-intern", name: "Alif", image: "https://x/a.png" };
const TAMU: SessionUser = { login: "", name: "", image: null };

function status(jenkins: "active" | "inactive" | "unknown", stale = false): ApiStatusResponse {
  return {
    data: {
      system_status: "idle",
      infra: { jenkins, nexus: "active" },
      stats: { total_apps: 0, running_containers: 0 },
      repository_health: { score_percent: 0, total_repos: 0, gold: 0, silver: 0, bronze: 0 },
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
    stale,
  };
}

afterEach(() => {
  nav.pathname = "/";
  vi.unstubAllGlobals();
});

describe("topbar route context", () => {
  function renderShell(pathname: string) {
    nav.pathname = pathname;
    // Hang the shared status fetch: the shell is all we assert here.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    return render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );
  }

  it.each([["/applications", "Daftar Aplikasi"], ["/pipeline", "Pipeline & Log"]])(
    "titles the 64px topbar with GCP breadcrumb format Autore / <Judul> (%s)",
    (pathname, expected) => {
      renderShell(pathname);

      const banner = within(screen.getByRole("banner"));
      const p = banner.getByText((content) => content.includes(expected), { selector: "p" });
      expect(p).toBeVisible();
      expect(p.textContent).toContain(`Autore / ${expected}`);
      expect(p.className).toContain("text-[#545F72]");
    },
  );

  it("leaves the topbar left side empty on the dashboard: no product name and no connection dot", () => {
    renderShell("/");

    const banner = within(screen.getByRole("banner"));
    // Nama produk sudah ada di sidebar, H1 sudah bilang "Dashboard", dan indikator
    // koneksi cuma milik footer sidebar, jadi topbar tidak mengulang satu pun.
    expect(banner.queryByText("Autore")).toBeNull();
    expect(banner.queryByText("Dashboard", { selector: "p" })).toBeNull();
    expect(banner.queryByRole("status")).toBeNull();
    // Kontrol kanan tetap ada sehingga topbar tidak runtuh tanpa breadcrumb.
    expect(banner.getByRole("button", { name: "Sync" })).toBeVisible();
  });

  it("mengecat kanvas kerangka #F0F5FE supaya celah di luar panel ikut biru muda", () => {
    const { container } = renderShell("/applications");

    const kerangka = container.querySelector("div.flex.min-h-screen") as HTMLElement;
    expect(kerangka.className).toContain("bg-[#F0F5FE]");
  });

  it("mengecat kanvas konten putih #FFFFFF, sementara topbar dan sidebar tetap #F0F5FE", () => {
    const { container } = renderShell("/applications");

    const kolom = container.querySelector("div.flex.min-w-0.flex-1") as HTMLElement;
    // Kolom jadi kanvas biru; panel putihnya pindah ke <main> supaya sudut kirinya
    // punya latar biru yang kelihatan sebagai lengkungan.
    expect(kolom.className).toContain("bg-[#F0F5FE]");
    expect(kolom.className).not.toContain("bg-white");
    // Sidebar keluar dari alur flex, jadi kolom mengisi lebar viewport penuh:
    // itulah sebabnya topbar benar-benar w-full dan tidak pernah terputus.
    expect(kolom.className).not.toContain("lg:ml-3");
    expect(kolom.className).not.toContain("lg:mr-2");
    expect(kolom.className).not.toContain("lg:pt-3");

    const main = container.querySelector("main") as HTMLElement;
    expect(main.className).toContain("bg-white");
    // Kartu konten melayang: mulai setelah 250px sidebar + 12px jarak + 12px celah,
    // sudut melengkung di keempat sisi, dan renggang 12px dari kanan & bawah.
    expect(main.className).toContain("lg:ml-[274px]");
    expect(main.className).toContain("lg:mr-3");
    expect(main.className).toContain("lg:mt-3");
    expect(main.className).toContain("lg:mb-3");
    expect(main.className).toContain("lg:w-auto");
    expect(main.className).toContain("lg:rounded-2xl");
    expect(main.className).not.toContain("lg:rounded-t-xl");
    expect(main.className).not.toContain("lg:ml-3");
    expect(main.className).not.toContain("lg:mr-2");
    // Scroll vertikal terjadi di dalam <main> pada desktop supaya sudut rounded
    // tidak pernah ketiban <header> saat halaman digulir ke bawah.
    const kerangka = container.querySelector("div.flex.min-h-screen") as HTMLElement;
    expect(kerangka.className).toContain("lg:h-screen");
    expect(kerangka.className).toContain("lg:overflow-hidden");
    expect(kolom.className).toContain("lg:overflow-hidden");
    expect(main.className).toContain("lg:overflow-y-auto");
    // Panel putih selebar kolom: batas lebar tidak boleh dipasang di sini, karena
    // sisa lebar viewport jadi latar biru yang makin lebar saat di-zoom out.
    expect(main.className).not.toContain("max-w-[");

    const isi = main.firstElementChild as HTMLElement;
    expect(isi.className).toContain("max-w-[1440px]");
    expect(isi.className).toContain("mx-auto");

    // Topbar biru muda selebar viewport, di layer belakang sidebar (z-20) supaya
    // tidak pernah terlihat putus. Sidebar memakai chrome yang sama; hanya kartu
    // konten yang putih.
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-[#F0F5FE]");
    expect(header.className).toContain("w-full");
    expect(header.className).toContain("z-10");
    // Isi topbar digeser ke kanan supaya tidak tersembunyi di balik kartu sidebar.
    expect((header.firstElementChild as HTMLElement).className).toContain("lg:pl-[274px]");
    expect((container.querySelector("aside") as HTMLElement).className).toContain("bg-[#F0F5FE]");
  });

  it("drops the sidebar and topbar on the auth pages", () => {
    renderShell("/login");

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Navigasi utama" })).toBeNull();
  });
});

describe("Navbar", () => {
  function renderNavbar(user: SessionUser, title = "Dashboard") {
    const hasil = render(<Navbar title={title} onSync={() => {}} user={user} />);
    // Isi <details> yang tertutup dianggap tidak terlihat oleh jsdom.
    const details = hasil.container.querySelector("details");
    if (details) details.open = true;
    return hasil;
  }

  it("carries the GCP breadcrumb title, Sync in #545F72 and the signed-in user", () => {
    renderNavbar(USER);

    expect(screen.queryByRole("heading")).toBeNull();
    const p = screen.getByText((c) => c.includes("Dashboard"), { selector: "p" });
    expect(p).toBeVisible();
    expect(p.textContent).toContain("Autore / Dashboard");
    expect(p.className).toContain("text-[#545F72]");
    // Indikator koneksi hanya milik footer sidebar, bukan topbar.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("connection-dot")).toBeNull();
    const syncBtn = screen.getByRole("button", { name: "Sync" });
    expect(syncBtn).toBeVisible();
    expect(syncBtn.className).toContain("text-[#545F72]");
    expect(screen.getByAltText("tugure-git-intern")).toBeVisible();
    expect(screen.getByRole("button", { name: /keluar/i })).toBeVisible();
  });

  it("menaruh breadcrumb di tepi kiri tanpa divider menggantung dan tanpa indikator tambahan", () => {
    const { container } = renderNavbar(USER, "Pipeline & Log");

    const banner = within(screen.getByRole("banner"));
    const judul = banner.getByText((c) => c.includes("Pipeline & Log"), { selector: "p" });

    // Topbar tidak punya titik hijau maupun teks status: itu milik footer sidebar.
    expect(banner.queryByRole("status")).toBeNull();
    expect(container.querySelector('[data-testid="connection-dot"]')).toBeNull();
    // Breadcrumb jadi elemen pertama di grup kiri, jadi tidak ada garis "|" menggantung.
    const grupKiri = judul.parentElement as HTMLElement;
    expect(grupKiri.className).toContain("items-center");
    expect(grupKiri.firstElementChild).toBe(judul);
    expect(container.querySelector("header")?.className).toContain("bg-[#F0F5FE]");
  });

  it("menjaga topbar polos tanpa lengkungan, tetap #F0F5FE dengan teks #545F72", () => {
    const { container } = renderNavbar(USER, "Audit Log");

    const header = container.querySelector("header") as HTMLElement;
    // Bar biasa: menempel penuh, tanpa lengkungan dan tanpa celah kanvas.
    expect(header.className).not.toContain("rounded");
    expect(header.className).not.toContain("mx-3");
    expect(header.className).not.toContain("mt-3");
    expect(header.className).toContain("bg-[#F0F5FE]");
    // Garis panjang di bawah topbar sudah dibuang: bar menyatu dengan kanvas.
    expect(header.className).not.toContain("border");

    const banner = within(screen.getByRole("banner"));
    expect(
      banner.getByText((c) => c.includes("Audit Log"), { selector: "p" }).className,
    ).toContain("text-[#545F72]");
    expect(banner.getByRole("button", { name: "Sync" }).className).toContain("text-[#545F72]");
    expect(banner.getByText("Alif").className).toContain("text-[#545F72]");
  });

  it("tanpa judul halaman, grup kiri kosong dan tidak ada status yang menggantung", () => {
    renderNavbar(USER, "");

    const banner = within(screen.getByRole("banner"));
    expect(banner.queryByRole("status")).toBeNull();
    expect(banner.queryByText("Terhubung")).toBeNull();
    expect(banner.queryByText((c) => c.includes("Autore /"), { selector: "p" })).toBeNull();
    // Kontrol kanan tetap utuh, jadi topbar tidak runtuh saat tanpa breadcrumb.
    expect(banner.getByRole("button", { name: "Sync" })).toBeVisible();
  });

  it("tidak menampilkan menu pengguna saat belum ada sesi", () => {
    renderNavbar(TAMU);

    expect(screen.queryByRole("button", { name: /keluar/i })).toBeNull();
    expect(screen.queryByText(/^@/)).toBeNull();
  });

  it("tidak lagi menampung navigasi: topbar cuma satu baris 64px", () => {
    const { container } = renderNavbar(USER);

    // Navigasi mobile pindah ke bar bawah; strip yang dulu menggeser horizontal
    // di dalam topbar sudah hilang.
    expect(within(screen.getByRole("banner")).queryByRole("navigation")).toBeNull();
    expect(container.querySelector("header")?.className).not.toContain("overflow-x-auto");
  });

  it("berputar dan terkunci selama sync, kembali normal setelah selesai", () => {
    const props = {
      title: "Dashboard",
      onSync: () => {},
      user: USER,
    };

    const { rerender } = render(<Navbar {...props} refreshing />);
    const berjalan = screen.getByRole("button", { name: "Sync" });
    expect(berjalan).toBeDisabled();
    expect(berjalan).toHaveAttribute("aria-busy", "true");
    expect(berjalan.querySelector("svg")?.getAttribute("class")).toContain(
      "motion-safe:animate-spin",
    );

    rerender(<Navbar {...props} />);
    const diam = screen.getByRole("button", { name: "Sync" });
    expect(diam).toBeEnabled();
    expect(diam).not.toHaveAttribute("aria-busy");
    expect(diam.querySelector("svg")?.getAttribute("class")).not.toContain("animate-spin");
  });

  it("menaruh menu kebab di antara Sync dan avatar, tanpa toggle tema lama, dan mendukung palet dark #282c32", () => {
    const { container } = renderNavbar(USER);
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-[#F0F5FE]");
    expect(header.className).toContain("dark:bg-[#282c32]");

    expect(screen.queryByTestId("theme-toggle")).toBeNull();
    const avatar = screen.getByAltText("tugure-git-intern");
    const kebab = screen.getByRole("button", { name: "Menu lainnya" });
    const sync = screen.getByRole("button", { name: "Sync" });
    // Urutan kiri ke kanan: Sync -> kebab -> avatar.
    expect(sync.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kebab.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});


describe("AppShell", () => {
  it("Sync menarik /api/status, /api/runs dan /api/active, bukan cuma status", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        ({ ok: true, status: 200, json: async () => status("active") }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppShell user={USER}>
        <div />
      </AppShell>,
    );

    const jalurTerpakai = () => new Set(fetchMock.mock.calls.map(([input]) => String(input)));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(jalurTerpakai()).toEqual(new Set(["/api/status", "/api/runs", "/api/active"]));

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    for (const url of ["/api/status", "/api/runs", "/api/active"]) {
      expect(fetchMock.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(2);
    }
  });
});
