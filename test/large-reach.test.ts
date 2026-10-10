import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

describe("alcance grande", () => {
  it("soma o alcance de contas acima do inteiro seguro sem responder 500", async () => {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO campaigns VALUES ('cmp_big', 'Grande', '["beleza"]');
      INSERT INTO creators VALUES ('crt_big', 'Grande', '["beleza"]', '');
      INSERT INTO social_accounts VALUES ('acc_1', 'crt_big', 'instagram'), ('acc_2', 'crt_big', 'tiktok');
      INSERT INTO metrics VALUES
        ('met_1', 'acc_1', 5000000000000000, '2026-05-30T00:00:00.000Z', ''),
        ('met_2', 'acc_2', 5000000000000000, '2026-05-30T00:00:00.000Z', '');
    `);
    const res = await createApp(db).request("/campaigns/cmp_big/creators");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { creators: Array<{ latest_reach: number }> };
    expect(body.creators[0]?.latest_reach).toBe(10000000000000000);
  });
});
