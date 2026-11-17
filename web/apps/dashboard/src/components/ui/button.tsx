import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-[#496cc3] text-white hover:bg-[#3d5aa8] dark:bg-[#839cff] dark:text-[#041e49] dark:hover:bg-[#9db1ff]",
  secondary:
    "border border-[#496cc3]/50 bg-white text-[#496cc3] hover:bg-[#496cc3]/10 dark:border-[#839cff]/50 dark:bg-[#2a3038] dark:text-[#839cff] dark:hover:bg-[#313841]",
  ghost:
    "text-muted hover:bg-gray-100 hover:text-ink dark:text-[var(--color-muted)] dark:hover:bg-[var(--bg-sidebar)] dark:hover:text-[var(--color-ink)]",
};

// "icon" keeps the 44px minimum touch target required for icon-only controls.
const sizes: Record<Size, string> = {
  md: "min-h-10 px-4 py-2 text-sm",
  icon: "h-11 w-11",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#496cc3] focus-visible:ring-offset-2 dark:focus-visible:ring-[#839cff] dark:focus-visible:ring-offset-[var(--bg-canvas)] ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
