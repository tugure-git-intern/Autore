import { render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { AppShell, StatusProvider } from "@/components/app-shell";
import DashboardPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders Autore Dashboard heading", () => {
  // Hang the shared status fetch so the page settles on its loading skeleton.
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <StatusProvider>
      <DashboardPage />
    </StatusProvider>,
  );

  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});

test("the topbar carries route context and never repeats the H1 word", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

  render(
    <AppShell>
      <DashboardPage />
    </AppShell>,
  );

  const h1 = screen.getByRole("heading", { name: "Dashboard" });
  const topbar = within(screen.getByRole("banner")).getByText("Autore", { selector: "p" });

  expect(topbar.textContent).not.toBe(h1.textContent);
  expect(topbar.textContent).not.toContain(h1.textContent ?? "");
});