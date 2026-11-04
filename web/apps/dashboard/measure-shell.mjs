// Ukur presisi di service VPS: tinggi header, warna active nav, tinggi panel empty state.
import { chromium } from "@playwright/test";

const BASE = process.env.TARGET || "http://100.80.3.14:9120";
const browser = await chromium.launch({
  channel: "chromium",
  ignoreDefaultArgs: ["--disable-field-trial-config"],
  args: ["--use-gl=swiftshader", "--disable-gpu", "--disable-software-rasterizer"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE + "/", { waitUntil: "networkidle" });

const m = await page.evaluate(() => {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const aside = document.querySelector("aside");
  const nav = document.querySelector("header");
  const brand = aside?.firstElementChild ?? null;
  const activeLink = document.querySelector("aside nav a[aria-current='page']");
  const panel = [...document.querySelectorAll("section,div")].find((el) =>
    el.textContent?.includes("Belum ada aplikasi yang didaftarkan."),
  );
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    viewportH: window.innerHeight,
    brand: rect(brand),
    header: rect(nav),
    brandBorderBottom: cs(brand)?.borderBottomWidth,
    headerBorderBottom: cs(nav)?.borderBottomWidth,
    activeLink: rect(activeLink),
    activeBg: cs(activeLink)?.backgroundColor,
    activeColor: cs(activeLink)?.color,
    activeClass: activeLink?.className,
    asideWidth: rect(aside)?.width,
    panelH: panel?.getBoundingClientRect().height,
    panelClass: panel?.className,
  };
});
console.log(JSON.stringify(m, null, 1));
await browser.close();
