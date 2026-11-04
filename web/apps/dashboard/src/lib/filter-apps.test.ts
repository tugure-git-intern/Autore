import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "./contracts";
import { filterApps } from "./filter-apps";

const app = (id: string, name: string, status: ApplicationRecord["status"]): ApplicationRecord => ({
  id,
  name,
  status,
  last_build: "",
  commit_sha: "",
  security_issues: 0,
});

const APPS = [
  app("tes-web", "tes-web", "passed"),
  app("ui-demo", "ui-demo", "failed"),
  app("uji-kontoh", "uji-kontoh", "unknown"),
  app("demo-api", "Demo API", "running"),
];

describe("filterApps", () => {
  it("mencari tanpa peduli huruf besar/kecil dan spasi tepi", () => {
    expect(filterApps(APPS, "  DEMO ", "all").map((a) => a.id)).toEqual(["ui-demo", "demo-api"]);
  });

  it("mencocokkan id maupun name", () => {
    expect(filterApps(APPS, "tes-web", "all").map((a) => a.id)).toEqual(["tes-web"]);
    expect(filterApps(APPS, "Demo API", "all").map((a) => a.id)).toEqual(["demo-api"]);
  });

  it("menyaring berdasarkan status", () => {
    expect(filterApps(APPS, "", "failed").map((a) => a.id)).toEqual(["ui-demo"]);
    expect(filterApps(APPS, "", "unknown").map((a) => a.id)).toEqual(["uji-kontoh"]);
    expect(filterApps(APPS, "", "passed").map((a) => a.id)).toEqual(["tes-web"]);
  });

  it("query kosong dengan filter all mengembalikan semua", () => {
    expect(filterApps(APPS, "", "all")).toHaveLength(4);
    expect(filterApps(APPS, "   ", "all")).toHaveLength(4);
  });

  it("tidak ada hasil jadi array kosong", () => {
    expect(filterApps(APPS, "tidak-ada", "all")).toEqual([]);
    expect(filterApps(APPS, "tes-web", "failed")).toEqual([]);
  });
});
