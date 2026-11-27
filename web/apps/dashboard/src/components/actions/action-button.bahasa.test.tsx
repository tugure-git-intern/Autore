import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { ToastSink } from "@/components/toast";
import { BahasaProvider } from "@/components/bahasa-provider";
import { runAction } from "@/lib/actions-client";
import { ActionButton } from "./action-button";

const CONFIRM = {
  title: "Yakin mau hapus?",
  warning: "Repo GitHub tidak disentuh.",
  confirmLabel: "Hapus",
  requireTypedName: "tes-web",
};

type Reply = { body?: unknown; ok?: boolean; status?: number };

function mockFetch(handler: () => Reply) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const reply = handler();
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        json: async () => reply.body ?? {},
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderEn(ui: ReactNode) {
  const kirim = vi.fn();
  const hasil = render(
    <BahasaProvider awal="en">
      <ToastSink.Provider value={kirim}>{ui}</ToastSink.Provider>
    </BahasaProvider>,
  );
  return { kirim, ...hasil };
}

test("pesan sukses aksi ikut bahasa Inggris", async () => {
  mockFetch(() => ({}));
  const { kirim } = renderEn(<ActionButton label="Deploy Now" action="deploy" app="tes-web" />);

  fireEvent.click(screen.getByRole("button", { name: "Deploy Now" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith(
      "Deploy submitted, the Jenkins build is running.",
      "sukses",
    ),
  );
});

test("kegagalan jaringan ikut bahasa Inggris", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
  const { kirim } = renderEn(<ActionButton label="Scan Now" action="scan" app="tes-web" />);

  fireEvent.click(screen.getByRole("button", { name: "Scan Now" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith(
      "Could not reach the action server. Check the network and retry.",
      "gagal",
    ),
  );
});

test("dialog konfirmasi dan label tombol ikut bahasa Inggris", () => {
  mockFetch(() => ({}));
  renderEn(
    <ActionButton label="Remove" action="remove" app="tes-web" confirm={CONFIRM} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Remove" }));

  const input = screen.getByLabelText("Type the application name to confirm");
  const label = document.querySelector(`label[for="${input.id}"]`);
  expect(label?.textContent).toContain("Type");
  expect(label?.textContent).toContain("to confirm");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("kunci terjemahan menang atas teks mentah dari klien", async () => {
  // Sesi berakhir: klien mengirim teks Indonesia, kamus Inggris yang dipakai.
  mockFetch(() => ({ ok: false, status: 401, body: {} }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    }),
  );
  const { kirim } = renderEn(<ActionButton label="Scan" action="scan" app="tes-web" />);

  fireEvent.click(screen.getByRole("button", { name: "Scan" }));

  await waitFor(() =>
    expect(kirim).toHaveBeenCalledWith("Your session has ended. Please sign in again.", "gagal"),
  );
});

test("klien aksi tetap mengirim pesan mentah sebagai cadangan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as unknown as Response),
  );

  const hasil = await runAction("scan", "tes-web");

  expect(hasil.message).toBe("boom");
  expect(hasil.kunci).toBeUndefined();
});
