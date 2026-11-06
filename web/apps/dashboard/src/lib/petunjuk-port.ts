/**
 * Galat Docker `port is already allocated` jujur tapi tidak bisa ditindak siapa pun.
 * Terjemahkan jadi pesan yang menyebut portnya dan menyuruh ganti `deployPort` —
 * satu-satunya hal yang bisa dilakukan operator saat port diperebutkan.
 */
const POLA_BENTROK = /Bind for [^\s]*:(\d+) failed: port is already allocated/;

export function petunjukPortBentrok(rawLog: string[]): string | null {
  for (const baris of rawLog) {
    const cocok = baris.match(POLA_BENTROK);
    if (cocok) {
      return `Port ${cocok[1]} sudah dipakai aplikasi lain. Ganti deployPort di Jenkinsfile ke port bebas, lalu deploy ulang.`;
    }
  }
  return null;
}
