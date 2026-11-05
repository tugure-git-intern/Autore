import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RepositoryHealth } from "@/lib/contracts";
import { RepositoryHealthCard } from "./repository-health-card";

const health = (extra: Partial<RepositoryHealth> = {}): RepositoryHealth => ({
  score_percent: 21,
  total_repos: 10,
  gold: 0,
  silver: 0,
  bronze: 10,
  ...extra,
});

describe("RepositoryHealthCard", () => {
  it("menampilkan judul, skor besar, dan rincian kelas dalam bahasa Indonesia", () => {
    render(<RepositoryHealthCard health={health()} />);

    expect(screen.getByText("Repository Health")).toBeVisible();
    expect(screen.getByText("21%")).toBeVisible();
    expect(screen.getByText("10 repos · 0 gold · 0 silver · 10 bronze")).toBeVisible();
  });

  it("menaruh ikon medali di kanan judul", () => {
    const { container } = render(<RepositoryHealthCard health={health()} />);

    const medali = container.querySelector("svg.lucide-medal");
    expect(medali).not.toBeNull();
    expect(medali).toHaveAttribute("aria-hidden", "true");
    // Satu baris dengan judul: judul kiri, ikon kanan.
    expect(screen.getByText("Repository Health").closest("div")?.contains(medali!)).toBe(true);
  });

  it("menampilkan nol persen tanpa NaN saat belum ada repo", () => {
    render(
      <RepositoryHealthCard
        health={health({ score_percent: 0, total_repos: 0, bronze: 0 })}
      />,
    );

    expect(screen.getByText("0%")).toBeVisible();
    expect(screen.getByText("0 repos · 0 gold · 0 silver · 0 bronze")).toBeVisible();
  });
});
