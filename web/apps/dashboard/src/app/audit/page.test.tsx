import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AuditPage from "./page";
import * as auditClient from "@/lib/audit-client";

describe("AuditPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("menampilkan skeleton loading saat memuat data lalu merender timeline", async () => {
    vi.spyOn(auditClient, "fetchAuditLog").mockResolvedValueOnce({
      data: [
        {
          ts: "2026-11-08T05:00:00.000Z",
          login: "Alif Fadlan",
          email: "maliffadlan@gmail.com",
          action: "deploy",
          target: "tes-web",
          exit: 0,
        },
      ],
      total: 1,
    });

    render(<AuditPage />);

    // Header terlihat
    expect(screen.getByRole("heading", { name: "Audit Log" })).toBeTruthy();
    expect(screen.getByText(/jejak audit aktivitas operasional dan pipeline/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Alif Fadlan")).toBeTruthy();
      expect(screen.getByText("tes-web")).toBeTruthy();
    });
  });

  it("kartu isi tanpa bingkai: putihnya menyatu dengan kanvas", async () => {
    vi.spyOn(auditClient, "fetchAuditLog").mockResolvedValueOnce({ data: [], total: 0 });

    const { container } = render(<AuditPage />);

    const kartu = container.querySelector("[class*='rounded-b-xl']") as HTMLElement;
    expect(kartu).toBeTruthy();
    expect(kartu.className).not.toContain("border");
  });

  it("menampilkan pesan error jika fetch gagal", async () => {
    vi.spyOn(auditClient, "fetchAuditLog").mockRejectedValueOnce(
      new Error("Gagal terhubung ke API")
    );

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText(/gagal memuat data audit log/i)).toBeTruthy();
      expect(screen.getByText("Gagal terhubung ke API")).toBeTruthy();
    });
  });
});
