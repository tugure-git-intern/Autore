import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { denganHostAsli } from "@/lib/auth-request-url";

// Auth.js menyusun `callbackUrl` provider dari `request.url`, yang di belakang
// `next start` berisi `localhost` — lihat `lib/auth-request-url.ts`.
export const GET = (req: NextRequest) => handlers.GET(denganHostAsli(req));
export const POST = (req: NextRequest) => handlers.POST(denganHostAsli(req));
