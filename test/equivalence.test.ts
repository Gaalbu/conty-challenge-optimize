import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { listCreators } from "../src/list-creators.ts";
import { CAMPAIGN_ID, seed } from "../src/seed.ts";
import { referenceListCreators } from "./reference/original-list-creators.ts";

type Db = ReturnType<typeof openDatabase>;

const PAGES = [
  { limit: 20, offset: 0 },
  { limit: 20, offset: 20 },
  { limit: 7, offset: 3 },
  { limit: 50, offset: 0 },
  { limit: 1, offset: 0 },
  { limit: 20, offset: 100_000 },
];

async function expectSameAsOriginal(db: Db, campaignId: string) {
  for (const page of PAGES) {
    const input = { campaignId, ...page };
    expect([page, await listCreators(db, input)]).toEqual([page, await referenceListCreators(db, input)]);
  }
}

describe("listagem igual à implementação original", () => {
  it.each([
    { creators: 80, seed: 7 },
    { creators: 600, seed: 7 },
    { creators: 1500, seed: 42 },
    { creators: 300, seed: 1234 },
  ])("em outros volumes e sementes: %j", async (options) => {
    const db = openDatabase(":memory:");
    seed(db, options);
    await expectSameAsOriginal(db, CAMPAIGN_ID);
  });

  it("desempata id na ordem de string do JavaScript (UTF-16), não na de bytes do SQLite", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO campaigns VALUES (?, ?, ?)").run("cmp_u", "Unicode", '["moda"]');
    for (const id of ["", "\u{10000}", "a", "\u{1F600}", "￿"]) {
      db.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)").run(id, id, '["moda"]', "");
    }
    await expectSameAsOriginal(db, "cmp_u");
  });

  it("empates de score e alcance, contas sem métrica, métrica empatada e nicho repetido", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO campaigns VALUES (?, ?, ?)").run("cmp_t", "Empates", '["beleza","moda","moda"]');
    const creator = db.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)");
    const account = db.prepare("INSERT INTO social_accounts VALUES (?, ?, ?)");
    const metric = db.prepare("INSERT INTO metrics VALUES (?, ?, ?, ?, ?)");
    const delivery = db.prepare("INSERT INTO deliveries VALUES (?, ?, ?)");
    for (let i = 0; i < 30; i += 1) {
      const id = `crt_t${String(29 - i).padStart(2, "0")}`;
      creator.run(id, `Empate ${i}`, i % 3 === 0 ? '["moda","moda"]' : '["beleza"]', "");
      if (i % 4 !== 0) account.run(`acc_${id}`, id, "instagram");
      if (i % 5 !== 0) {
        metric.run(`met_${id}_a`, `acc_${id}`, 500, "2026-05-30T00:00:00.000Z", "");
        metric.run(`met_${id}_b`, `acc_${id}`, 400 + i, "2026-05-30T00:00:00.000Z", "");
      }
      if (i % 2 === 0) delivery.run(`del_${id}`, id, "2026-03-03T12:00:00.000Z");
    }
    await expectSameAsOriginal(db, "cmp_t");
  });

  it("compara nichos com o === do JavaScript: true não casa com 1, null casa com null, objeto nunca casa", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO campaigns VALUES (?, ?, ?)").run("cmp_j", "Tipos", JSON.stringify([1, "1", true, null, 2.0, { a: 1 }, [1]]));
    const niches: Record<string, unknown[]> = {
      a_true: [true], b_one: [1], c_text: ["1"], d_null: [null], e_real: [2], f_obj: [{ a: 1 }], g_arr: [[1]], h_false: [false],
    };
    for (const [id, list] of Object.entries(niches)) {
      db.prepare("INSERT INTO creators VALUES (?, ?, ?, ?)").run(id, id, JSON.stringify(list), "");
    }
    await expectSameAsOriginal(db, "cmp_j");
  });

  it("campanha sem nichos devolve total zero, como a original", async () => {
    const db = openDatabase(":memory:");
    seed(db, { creators: 80, seed: 7 });
    db.prepare("INSERT INTO campaigns VALUES (?, ?, ?)").run("cmp_vazia", "Vazia", "[]");
    await expectSameAsOriginal(db, "cmp_vazia");
    expect(await listCreators(db, { campaignId: "cmp_vazia", limit: 20, offset: 0 })).toEqual({
      campaign_id: "cmp_vazia",
      total: 0,
      creators: [],
    });
  });

  it("reflete na resposta seguinte dados alterados, movidos e apagados, sem cache", async () => {
    const db = openDatabase(":memory:");
    seed(db, { creators: 80, seed: 7 });
    await expectSameAsOriginal(db, CAMPAIGN_ID);
    db.exec(`
      UPDATE metrics SET views = views * 3 WHERE rowid % 7 = 0;
      UPDATE social_accounts SET creator_id = 'crt_0002' WHERE rowid % 11 = 0;
      DELETE FROM deliveries WHERE rowid % 5 = 0;
      UPDATE creators SET niches_json = '["games"]' WHERE rowid % 9 = 0;
    `);
    await expectSameAsOriginal(db, CAMPAIGN_ID);
  });
});
