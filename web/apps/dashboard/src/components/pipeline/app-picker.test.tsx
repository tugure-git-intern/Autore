import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ApplicationRecord } from "@/lib/contracts";
import { AppPicker } from "./app-picker";

const app = (ubah: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: "a",
  name: "App A",
  status: "unknown",
  last_build: "",
  commit_sha: "",
  security_issues: 0,
  ...ubah,
});

const baris = () => screen.getAllByTestId("app-picker-row");

test("memberi aksen merah pada aplikasi gagal dan hijau pada yang lulus", () => {
  render(
    <AppPicker
      applications={[
        app({ id: "gagal", name: "Gagal", status: "failed" }),
        app({ id: "lulus", name: "Lulus", status: "passed" }),
      ]}
      onPilih={() => {}}
    />,
  );

  expect(baris()[0].className).toContain("border-l-red-500");
  expect(baris()[1].className).toContain("border-l-green-500");
});

test("menandai baris terpilih lewat aria-current dan tidak menandai yang lain", () => {
  render(
    <AppPicker
      applications={[app({ id: "a", name: "App A" }), app({ id: "b", name: "App B" })]}
      terpilih="b"
      onPilih={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: /App A/ })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("button", { name: /App B/ })).toHaveAttribute("aria-current", "true");
});

test("melaporkan id yang diklik tanpa menavigasi sendiri", () => {
  const onPilih = vi.fn();
  render(<AppPicker applications={[app({ id: "a", name: "App A" })]} onPilih={onPilih} />);

  fireEvent.click(screen.getByRole("button", { name: /App A/ }));

  expect(onPilih).toHaveBeenCalledWith("a");
});

test("menulis 'Belum ada build' alih-alih waktu karangan saat build belum ada", () => {
  render(
    <AppPicker
      applications={[
        app({ id: "belum", name: "Belum", last_build: "" }),
        app({ id: "sudah", name: "Sudah", last_build: "2026-11-01T10:00:00Z" }),
      ]}
      onPilih={() => {}}
    />,
  );

  expect(baris()[0]).toHaveTextContent("Belum ada build");
  expect(baris()[1]).not.toHaveTextContent("Belum ada build");
});

test("ArrowDown memindahkan fokus ke baris berikutnya, End ke baris terakhir", () => {
  render(
    <AppPicker
      applications={[app({ id: "a", name: "App A" }), app({ id: "b", name: "App B" }), app({ id: "c", name: "App C" })]}
      onPilih={() => {}}
    />,
  );

  baris()[0].focus();
  fireEvent.keyDown(baris()[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(baris()[1]);

  fireEvent.keyDown(baris()[1], { key: "End" });
  expect(document.activeElement).toBe(baris()[2]);

  fireEvent.keyDown(baris()[2], { key: "Home" });
  expect(document.activeElement).toBe(baris()[0]);
});