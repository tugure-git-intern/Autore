import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button UI component", () => {
  it("menyertakan kelas focus-visible ring untuk aksesibilitas keyboard", () => {
    render(<Button>Klik</Button>);
    const btn = screen.getByRole("button", { name: /Klik/i });
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:outline-none");
  });
});
