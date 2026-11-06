import { expect, test } from "vitest";
import { petunjukPortBentrok } from "./petunjuk-port";

test("menerjemahkan galat Docker port bentrok jadi pesan yang bisa ditindak", () => {
  const log = [
    "[deploy] Menjalankan container kandidat pada port sementara 127.0.0.1:18088...",
    "docker: Error response from daemon: driver failed programming external connectivity: " +
      "Bind for 127.0.0.1:8088 failed: port is already allocated.",
  ];

  expect(petunjukPortBentrok(log)).toBe(
    "Port 8088 sudah dipakai aplikasi lain. Ganti deployPort di Jenkinsfile ke port bebas, lalu deploy ulang.",
  );
});

test("tidak mengarang petunjuk kalau log bukan soal port", () => {
  expect(petunjukPortBentrok(["Pipeline gagal di tahap scan."])).toBeNull();
  expect(petunjukPortBentrok([])).toBeNull();
});
