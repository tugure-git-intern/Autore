import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationsFilter } from "./applications-filter";

function pasang(over: Partial<Parameters<typeof ApplicationsFilter>[0]> = {}) {
  const props = {
    query: "",
    onQueryChange: vi.fn(),
    status: "all" as const,
    onStatusChange: vi.fn(),
    total: 10,
    shown: 10,
    ...over,
  };
  render(<ApplicationsFilter {...props} />);
  return props;
}

describe("ApplicationsFilter", () => {
  it("melaporkan tiap ketikan ke pemanggil", () => {
    const props = pasang();

    fireEvent.change(screen.getByRole("searchbox", { name: "Cari aplikasi" }), {
      target: { value: "demo" },
    });

    expect(props.onQueryChange).toHaveBeenCalledWith("demo");
  });

  it("menawarkan empat opsi status dan melaporkan pilihannya", () => {
    const props = pasang();

    const pilihan = screen.getByRole("combobox", { name: "Status" });
    expect(Array.from((pilihan as HTMLSelectElement).options).map((opt) => opt.textContent)).toEqual([
      "Semua status",
      "Lulus",
      "Gagal",
      "Unknown",
    ]);

    fireEvent.change(pilihan, { target: { value: "failed" } });

    expect(props.onStatusChange).toHaveBeenCalledWith("failed");
  });

  it("menampilkan jumlah hasil", () => {
    pasang({ total: 10, shown: 3 });

    expect(screen.getByText("3 dari 10 aplikasi")).toBeVisible();
  });
});
