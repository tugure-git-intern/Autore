import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditTimeline } from "./audit-timeline";
import type { AuditEntry } from "@/lib/audit-client";

const ENTRIES: AuditEntry[] = [
  {
    ts: "2026-11-08T05:00:00.000Z",
    login: "Alif Fadlan",
    email: "maliffadlan@gmail.com",
    action: "deploy",
    target: "tes-web",
    exit: 0,
  },
  {
    ts: "2026-11-07T12:00:00.000Z",
    login: "Tugure Git",
    email: "bot@tugu.com",
    action: "scan",
    target: "java-tes",
    exit: 1,
  },
  {
    ts: "2026-11-06T08:00:00.000Z",
    login: "Budi Utomo",
    email: "budi@tugu.com",
    action: "quick-start",
    target: "audit-uji3",
    exit: 0,
  },
];

describe("AuditTimeline", () => {
  it("merender daftar timeline dengan avatar, inisial, narasi, dan badge status", () => {
    render(<AuditTimeline entries={ENTRIES} />);

    // Inisial avatar dua kata: "AF", "TG", "BU"
    expect(screen.getByText("AF")).toBeTruthy();
    expect(screen.getByText("TG")).toBeTruthy();
    expect(screen.getByText("BU")).toBeTruthy();

    // Narasi user & target
    expect(screen.getByText("Alif Fadlan")).toBeTruthy();
    expect(screen.getByText("tes-web")).toBeTruthy();
    expect(screen.getByText("java-tes")).toBeTruthy();
    expect(screen.getByText("audit-uji3")).toBeTruthy();

    // Status badges (2 di badge item + 1 di option dropdown filter = 3 total)
    const suksesBadges = screen.getAllByText("Sukses");
    expect(suksesBadges.length).toBe(3);
    expect(screen.getByText("Gagal (1)")).toBeTruthy();
  });

  it("menyaring item berdasarkan pencarian teks (user / target)", () => {
    render(<AuditTimeline entries={ENTRIES} />);

    const searchInput = screen.getByPlaceholderText(/cari pengguna atau nama aplikasi/i);
    fireEvent.change(searchInput, { target: { value: "java-tes" } });

    expect(screen.getByText("java-tes")).toBeTruthy();
    expect(screen.queryByText("tes-web")).toBeNull();
    expect(screen.queryByText("audit-uji3")).toBeNull();
  });

  it("menyaring item berdasarkan filter dropdown aksi", () => {
    render(<AuditTimeline entries={ENTRIES} />);

    const aksiSelect = screen.getByLabelText(/filter aksi/i);
    fireEvent.change(aksiSelect, { target: { value: "scan" } });

    expect(screen.getByText("java-tes")).toBeTruthy();
    expect(screen.queryByText("tes-web")).toBeNull();
    expect(screen.queryByText("audit-uji3")).toBeNull();
  });

  it("menyaring item berdasarkan filter dropdown status", () => {
    render(<AuditTimeline entries={ENTRIES} />);

    const statusSelect = screen.getByLabelText(/filter status/i);
    fireEvent.change(statusSelect, { target: { value: "failed" } });

    expect(screen.getByText("java-tes")).toBeTruthy();
    expect(screen.queryByText("tes-web")).toBeNull();
    expect(screen.queryByText("audit-uji3")).toBeNull();
  });

  it("menampilkan empty state jika hasil pencarian kosong dan tombol reset filter bekerja", () => {
    render(<AuditTimeline entries={ENTRIES} />);

    const searchInput = screen.getByPlaceholderText(/cari pengguna atau nama aplikasi/i);
    fireEvent.change(searchInput, { target: { value: "tidak-ada-aplikasi" } });

    expect(screen.getByText(/tidak ada aktivitas yang cocok/i)).toBeTruthy();
    const resetBtn = screen.getByRole("button", { name: /reset filter/i });
    fireEvent.click(resetBtn);

    expect(screen.getByText("tes-web")).toBeTruthy();
  });
});
