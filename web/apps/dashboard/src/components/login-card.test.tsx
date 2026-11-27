import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BahasaProvider } from "./bahasa-provider";
import { LoginCard } from "./login-card";

describe("LoginCard", () => {
  it("menampilkan satu tombol GitHub dan tidak ada field password", () => {
    render(<LoginCard action={() => {}} />);

    expect(screen.getByRole("button", { name: /Lanjut dengan GitHub/i })).toBeVisible();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("menjelaskan bahwa akses dibatasi akun terdaftar", () => {
    render(<LoginCard action={() => {}} />);

    expect(screen.getByRole("heading", { name: /Masuk/i })).toBeVisible();
    expect(screen.getByText(/hanya akun yang terdaftar/i)).toBeVisible();
  });

  it("mengirim form ke aksi yang diberikan pemanggil", () => {
    let terkirim = false;
    render(
      <LoginCard
        action={() => {
          terkirim = true;
        }}
      />,
    );

    const form = screen.getByRole("button", { name: /GitHub/i }).closest("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).getByText(/GitHub/i)).toBeVisible();
    expect(typeof (form as HTMLFormElement).requestSubmit).toBe("function");
    expect(terkirim).toBe(false); // aksi hanya jalan setelah submit, bukan saat render
  });
});

describe("LoginCard dalam bahasa Inggris", () => {
  it("menerjemahkan judul, penjelasan, dan tombol", () => {
    render(
      <BahasaProvider awal="en">
        <LoginCard action={() => {}} />
      </BahasaProvider>,
    );

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Only registered accounts may open this dashboard.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with GitHub/ })).toBeTruthy();
    expect(screen.getByText(/Autore stores no passwords/)).toBeTruthy();
  });
});
