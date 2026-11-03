import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

test("renders Autore Dashboard heading", () => {
  render(<DashboardPage />);
  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
});