import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BahasaProvider } from "./bahasa-provider";
import { RepositoryHealthCard } from "./repository-health-card";

test("kartu kesehatan repo ikut bahasa Inggris", () => {
  render(
    <BahasaProvider awal="en">
      <RepositoryHealthCard
        health={{ score_percent: 80, total_repos: 5, gold: 1, silver: 2, bronze: 2 }}
      />
    </BahasaProvider>,
  );

  expect(screen.getByText("Repository Health")).toBeVisible();
  expect(screen.getByText("5 repos · 1 gold · 2 silver · 2 bronze")).toBeVisible();
});
