"use client";

import { useEffect, useRef, useState } from "react";

export interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration,
  format,
  className,
}: AnimatedNumberProps) {
  const resolvedDuration =
    duration !== undefined
      ? duration
      : typeof process !== "undefined" && process.env.NODE_ENV === "test"
        ? 0
        : 800;

  const [display, setDisplay] = useState(() => (resolvedDuration <= 0 ? value : 0));
  const currentRef = useRef(resolvedDuration <= 0 ? value : 0);

  useEffect(() => {
    const startValue = currentRef.current;
    const targetValue = value;

    if (startValue === targetValue || resolvedDuration <= 0) {
      currentRef.current = targetValue;
      setDisplay(targetValue);
      return;
    }

    let startTime: number | null = null;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let animFrameId: number | null = null;

    const hasRaf =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";

    if (hasRaf) {
      const step = (now: number) => {
        if (startTime === null) startTime = now;
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / resolvedDuration);
        // Ease-out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(startValue + (targetValue - startValue) * easeOut);

        currentRef.current = current;
        setDisplay(current);

        if (progress < 1) {
          animFrameId = window.requestAnimationFrame(step);
        } else {
          currentRef.current = targetValue;
          setDisplay(targetValue);
        }
      };

      animFrameId = window.requestAnimationFrame(step);
    } else {
      const stepInterval = 16;
      startTime = Date.now();

      timerId = setInterval(() => {
        const elapsed = Date.now() - (startTime ?? Date.now());
        const progress = Math.min(1, elapsed / resolvedDuration);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(startValue + (targetValue - startValue) * easeOut);

        currentRef.current = current;
        setDisplay(current);

        if (progress >= 1 && timerId) {
          clearInterval(timerId);
          currentRef.current = targetValue;
          setDisplay(targetValue);
        }
      }, stepInterval);
    }

    return () => {
      if (animFrameId !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(animFrameId);
      }
      if (timerId !== null) {
        clearInterval(timerId);
      }
    };
  }, [value, resolvedDuration]);

  const rendered = format ? format(display) : String(display);

  return (
    <span data-testid="animated-number" className={className}>
      {rendered}
    </span>
  );
}
