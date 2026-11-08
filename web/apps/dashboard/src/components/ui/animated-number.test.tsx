import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedNumber } from "./animated-number";

describe("AnimatedNumber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("animates from 0 to target value over duration", () => {
    render(<AnimatedNumber value={100} duration={800} />);

    expect(screen.getByTestId("animated-number")).toHaveTextContent("0");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    const midValue = Number(screen.getByTestId("animated-number").textContent);
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(100);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId("animated-number")).toHaveTextContent("100");
  });

  it("transitions from previous value to new value without resetting to 0", () => {
    const { rerender } = render(<AnimatedNumber value={50} duration={800} />);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId("animated-number")).toHaveTextContent("50");

    rerender(<AnimatedNumber value={80} duration={800} />);

    // Value should NOT drop to 0
    const startOfSecond = Number(screen.getByTestId("animated-number").textContent);
    expect(startOfSecond).toBeGreaterThanOrEqual(50);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId("animated-number")).toHaveTextContent("80");
  });

  it("supports custom format function", () => {
    render(<AnimatedNumber value={25} duration={800} format={(n) => `${n}%`} />);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId("animated-number")).toHaveTextContent("25%");
  });
});
