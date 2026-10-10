import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { CAMPAIGN_ID, FIXTURE_SEED, seed } from "../src/seed.ts";

describe("parâmetros de paginação pela API", () => {
  const db = openDatabase(":memory:");
  seed(db, FIXTURE_SEED);
  const app = createApp(db);
  const page = async (query: string) =>
    (await (await app.request(`/campaigns/${CAMPAIGN_ID}/creators?${query}`)).json()) as {
      total: number;
      creators: Array<{ id: string }>;
    };

  it("limit 0 vira 20, limit acima de 50 vira 50, offset negativo ou inválido vira 0", async () => {
    const reference = await page("limit=20&offset=0");
    expect((await page("limit=0")).creators).toEqual(reference.creators);
    expect((await page("limit=999")).creators).toHaveLength(Math.min(50, reference.total));
    expect((await page("limit=20&offset=-5")).creators).toEqual(reference.creators);
    expect((await page("limit=abc&offset=xyz")).creators).toEqual(reference.creators);
  });

  it("percorre todas as páginas sem repetir nem perder criador", async () => {
    const { total } = await page("limit=20&offset=0");
    const seen: string[] = [];
    for (let offset = 0; offset < total; offset += 7) {
      seen.push(...(await page(`limit=7&offset=${offset}`)).creators.map((c) => c.id));
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });
});
