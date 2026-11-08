import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { History } from "lucide-react";
import { PageTabHeader } from "./page-tab-header";

describe("PageTabHeader", () => {
  it("merender tab card dengan latar putih, sudut melengkung atas, dan border-b-0", () => {
    const { container } = render(
      <PageTabHeader
        title="Audit Log"
        description="Jejak audit aktivitas operasional"
        icon={History}
        action={<button type="button">Aksi</button>}
      />,
    );

    const header = container.querySelector("[data-testid='page-tab-header']") as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.className).toContain("bg-white");
    expect(header.className).toContain("rounded-t-xl");
    expect(header.className).toContain("border");
    expect(header.className).toContain("border-b-0");

    expect(screen.getByRole("heading", { name: "Audit Log" })).toBeVisible();
    expect(screen.getByText("Jejak audit aktivitas operasional")).toBeVisible();
    expect(screen.getByRole("button", { name: "Aksi" })).toBeVisible();
  });

  it("dapat dirender tanpa ikon atau aksi", () => {
    render(<PageTabHeader title="Daftar Aplikasi" />);

    expect(screen.getByRole("heading", { name: "Daftar Aplikasi" })).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
