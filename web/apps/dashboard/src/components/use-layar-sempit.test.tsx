import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayarSempit } from "./use-layar-sempit";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** matchMedia tiruan: jsdom tidak punya, jadi ambangnya diuji lewat stub ini. */
function pasangMatchMedia(awal: boolean) {
  const pendengar = new Set<() => void>();
  const dilepas: string[] = [];
  const mq = {
    matches: awal,
    addEventListener: (_jenis: string, cb: () => void) => pendengar.add(cb),
    removeEventListener: (jenis: string) => {
      dilepas.push(jenis);
      pendengar.clear();
    },
  };
  const matchMedia = vi.fn((_kueri: string) => mq);
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    matchMedia,
    dilepas,
    keadaan: () => screen.getByTestId("keadaan").textContent ?? "",
    ubahBerikutnya: async (nilai: boolean) => {
      mq.matches = nilai;
      await act(async () => {
        pendengar.forEach((cb) => cb());
      });
    },
  };
}

function Probe() {
  return <span data-testid="keadaan">{useLayarSempit() ? "sempit" : "lebar"}</span>;
}

describe("useLayarSempit", () => {
  it("bertanya pada ambang lg yang sama dengan sidebar dan bar bawah", () => {
    const stub = pasangMatchMedia(false);

    render(<Probe />);

    expect(stub.matchMedia.mock.calls[0][0]).toBe("(max-width: 1023px)");
    expect(stub.keadaan()).toBe("lebar");
  });

  it("sempit hanya kalau viewport memang di bawah lg", () => {
    const stub = pasangMatchMedia(true);

    render(<Probe />);

    expect(stub.keadaan()).toBe("sempit");
  });

  it("ikut berubah saat layar melewati ambang", async () => {
    const stub = pasangMatchMedia(false);

    render(<Probe />);

    expect(stub.keadaan()).toBe("lebar");
    await stub.ubahBerikutnya(true);
    expect(stub.keadaan()).toBe("sempit");
    await stub.ubahBerikutnya(false);
    expect(stub.keadaan()).toBe("lebar");
  });

  it("melepas pendengarnya saat komponen unmount", () => {
    const stub = pasangMatchMedia(true);

    const { unmount } = render(<Probe />);
    unmount();

    expect(stub.dilepas).toEqual(["change"]);
  });

  it("tanpa matchMedia (jsdom biasa) tetap 'lebar', bukan error", () => {
    render(<Probe />);

    expect(screen.getByTestId("keadaan")).toHaveTextContent("lebar");
  });
});
