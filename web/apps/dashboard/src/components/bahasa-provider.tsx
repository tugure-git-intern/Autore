"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BAHASA_BAWAAN,
  COOKIE_BAHASA,
  isiPola,
  terjemah,
  type Bahasa,
  type KunciTerjemah,
} from "@/lib/i18n";

type KonteksBahasa = {
  bahasa: Bahasa;
  setBahasa: (baru: Bahasa) => void;
  /** Terjemahan satu kunci di bahasa aktif. */
  t: (kunci: KunciTerjemah) => string;
  /** Sama seperti `t()`, tapi mengisi placeholder `{nama}` di dalam kalimat. */
  tf: (kunci: KunciTerjemah, isi: Record<string, string | number>) => string;
};

/**
 * Default Indonesia + setter mati: komponen shell tetap bisa dirender sendirian
 * (tes satuan, story) tanpa membungkus provider lebih dulu.
 */
const Konteks = createContext<KonteksBahasa>({
  bahasa: BAHASA_BAWAAN,
  setBahasa: () => {},
  t: (kunci) => terjemah(BAHASA_BAWAAN, kunci),
  tf: (kunci, isi) => isiPola(terjemah(BAHASA_BAWAAN, kunci), isi),
});

export function useBahasa(): KonteksBahasa {
  return useContext(Konteks);
}

/**
 * Bahasa aktif hidup di client, tapi pilihannya diingat cookie — `layout.tsx`
 * membacanya di server, jadi bahasa yang tersimpan sudah benar sejak HTML
 * pertama. `<html lang>` diperbarui di sini saat berganti tanpa reload.
 */
export function BahasaProvider({ awal, children }: { awal: Bahasa; children: ReactNode }) {
  const [bahasa, setBahasaState] = useState<Bahasa>(awal);

  const setBahasa = useCallback((baru: Bahasa) => {
    setBahasaState(baru);
    document.documentElement.lang = baru;
    document.cookie = `${COOKIE_BAHASA}=${baru}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  const nilai = useMemo<KonteksBahasa>(
    () => ({
      bahasa,
      setBahasa,
      t: (kunci) => terjemah(bahasa, kunci),
      tf: (kunci, isi) => isiPola(terjemah(bahasa, kunci), isi),
    }),
    [bahasa, setBahasa],
  );

  return <Konteks.Provider value={nilai}>{children}</Konteks.Provider>;
}
