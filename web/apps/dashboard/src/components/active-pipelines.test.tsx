import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActiveCounts, ActivePipeline } from "@/lib/contracts";
import { ActivePipelines } from "./active-pipelines";

const pipeline = (extra: Partial<ActivePipeline> = {}): ActivePipeline => ({
  app: "tes-web",
  number: 42,
  status: "running",
  branch: "main",
  commit_sha: "3878d9307475eb84316edde4e77f63fd0b98ae4e",
  author: "Alif Fadlan <alif@example.test>",
  started_at: "2026-11-05T03:23:08Z",
  url: "http://100.80.3.14:8080/job/tes-web/42",
  ...extra,
});

const antre = (extra: Partial<ActivePipeline> = {}): ActivePipeline =>
  pipeline({ app: "ui-demo", number: 0, status: "queued", branch: "", commit_sha: "", author: "", url: "http://100.80.3.14:8080/job/ui-demo", ...extra });

const counts = (active: readonly ActivePipeline[]): ActiveCounts => ({
  running: active.filter((p) => p.status === "running").length,
  queued: active.filter((p) => p.status === "queued").length,
});

const gambar = (active: readonly ActivePipeline[], stale = false) => {
  const hasil = render(
    <ActivePipelines active={active} counts={counts(active)} stale={stale} />,
  );
  return { ...hasil, kartu: () => screen.queryAllByTestId("pipeline-card") };
};

describe("ActivePipelines", () => {
  it("menampilkan judul dan hitungan dalam bahasa Indonesia", () => {
    gambar([pipeline(), antre()]);

    expect(screen.getByRole("heading", { name: "Active Pipelines" })).toBeInTheDocument();
    expect(screen.getByText("2 berjalan atau menunggu")).toBeInTheDocument();
  });

  it("menaruh ikon petir hijau di samping hitungan", () => {
    gambar([pipeline()]);

    const hitungan = screen.getByText("1 berjalan atau menunggu");
    expect(hitungan.querySelector("svg")).not.toBeNull();
    expect(hitungan.className).toContain("text-green-700");
  });

  it("kartu berjalan memakai badge biru dan bar indeterminate", () => {
    const { kartu } = gambar([pipeline()]);

    const isi = within(kartu()[0]);
    expect(isi.getByText("Berjalan")).toBeInTheDocument();
    expect(isi.getByText("Berjalan").className).toContain("bg-blue-100");
    expect(isi.getByTestId("progress-indeterminate")).toBeInTheDocument();
  });

  it("bar indeterminate memenuhi lebar kartu dengan ekor komet yang menempel", () => {
    const { kartu } = gambar([pipeline()]);

    const isi = within(kartu()[0]);
    const track = isi.getByTestId("progress-indeterminate");
    expect(track.className).toContain("absolute");
    expect(track.className).toContain("inset-x-0");
    expect(track.className).toContain("overflow-hidden");
    expect(track.className).toContain("bg-blue-500/15");

    // Komet = satu pembungkus rigid selebar 2/3 kartu; kepala dan ekornya masing-masing 1/3.
    // Dulu dua pita dibedakan fasa lewat `animation-delay`, tapi hasil ukur di browser: begitu
    // satu pita wrap ke kanan sementara yang lain belum, pasangan itu pecah ~25% siklus.
    // Pembungkus rigid membuat keduanya selalu menempel, berapa pun fasenya.
    const komet = isi.getByTestId("progress-comet");
    expect(komet.className).toContain("w-2/3");
    expect(komet.className).toContain("flex");
    expect(komet.className).toContain("motion-safe:animate-[geser_1.6s_linear_infinite]");

    const depan = isi.getByTestId("progress-band-depan");
    const ekor = isi.getByTestId("progress-band-belakang");
    for (const pita of [depan, ekor]) {
      expect(pita.className).toContain("w-1/2");
      expect(pita.className).not.toContain("animate-");
    }
    expect(depan.className).toContain("bg-blue-500");
    expect(ekor.className).toContain("bg-blue-400/50");
    // Ujungnya dibulatkan hanya di sisi luar komet, supaya sambungannya tidak terlihat.
    expect(ekor.className).toContain("rounded-l-full");
    expect(depan.className).toContain("rounded-r-full");
    for (const pita of [depan, ekor]) {
      expect(pita.className).not.toContain("[animation-delay:");
    }
    expect(ekor.className).not.toEqual(depan.className);
  });

  it("reduced motion: pita hilang, tapinya tetap solid selebar kartu", () => {
    const { kartu } = gambar([pipeline()]);

    const isi = within(kartu()[0]);
    const track = isi.getByTestId("progress-indeterminate");

    // jsdom tidak mengevaluasi media query, jadi di sini yang dikunci kelasnya saja;
    // perilaku aslinya dibuktikan di e2e lewat `emulateMedia({ reducedMotion })`.
    expect(track.className).toContain("motion-reduce:bg-blue-500");
    expect(isi.getByTestId("progress-comet").className).toContain("motion-reduce:hidden");
  });

  it("kartu menunggu memakai badge kuning tanpa bar", () => {
    const { kartu } = gambar([antre()]);

    const isi = within(kartu()[0]);
    expect(isi.getByText("Menunggu").className).toContain("bg-yellow-100");
    expect(isi.queryByTestId("progress-indeterminate")).toBeNull();
  });

  it("menampilkan branch, commit monospace, dan inisial penulis", () => {
    const { kartu } = gambar([pipeline()]);

    const isi = within(kartu()[0]);
    expect(isi.getByText("main")).toBeInTheDocument();
    expect(isi.getByText("Alif Fadlan <alif@example.test>")).toBeInTheDocument();
    expect(isi.getByText("AF")).toBeInTheDocument();

    const tautan = isi.getByRole("link", { name: "3878d93" });
    expect(tautan.className).toContain("font-mono");
    expect(tautan).toHaveAttribute("href", "http://100.80.3.14:8080/job/tes-web/42");
    expect(tautan).toHaveAttribute("target", "_blank");
  });

  it("nomor build 0 disembunyikan untuk yang masih menunggu", () => {
    const { kartu } = gambar([antre()]);

    expect(within(kartu()[0]).queryByText("#0")).toBeNull();
  });

  it("branch kosong jadi strip, dan baris penulis kosong disembunyikan", () => {
    const { kartu, container } = gambar([antre()]);

    const isi = within(kartu()[0]);
    expect(isi.getAllByText("—")).toHaveLength(2); // cuma branch dan commit
    expect(isi.queryByText("?")).toBeNull();
    expect(container.querySelector("span.rounded-full")).toBeNull();
  });

  it("baris penulis tetap tampil kalau Jenkins mengirim namanya", () => {
    const { kartu, container } = gambar([pipeline()]);

    const isi = within(kartu()[0]);
    expect(isi.getByText("Alif Fadlan <alif@example.test>")).toBeInTheDocument();
    expect(isi.getByText("AF")).toBeInTheDocument();
    expect(container.querySelector("span.rounded-full")).not.toBeNull();
  });

  it("empty state tetap tampil supaya fiturnya terlihat ada", () => {
    const { kartu } = gambar([]);

    expect(screen.getByText("Semua pipeline selesai")).toBeInTheDocument();
    expect(screen.getByText("0 berjalan atau menunggu")).toBeInTheDocument();
    expect(kartu()).toHaveLength(0);
  });

  it("menandai data terakhir saat payload basi", () => {
    gambar([pipeline()], true);

    expect(screen.getByText("data terakhir")).toBeInTheDocument();
  });

  it("tidak menambah gradien atau bayangan lebih berat dari shadow-sm", () => {
    const { container } = gambar([pipeline(), antre()]);

    const kelas = [...container.querySelectorAll("*")].flatMap((el) =>
      (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
    );
    expect(kelas.filter((k) => /gradient/.test(k))).toEqual([]);
    expect(kelas.filter((k) => /^shadow-(?!sm$)/.test(k))).toEqual([]);
  });
});
