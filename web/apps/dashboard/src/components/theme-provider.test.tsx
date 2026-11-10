import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "./theme-provider";

describe("ThemeProvider", () => {
  it("merender children di dalam provider tema", () => {
    render(
      <ThemeProvider>
        <div data-testid="anak">Konten Uji</div>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("anak")).toHaveTextContent("Konten Uji");
  });
});
