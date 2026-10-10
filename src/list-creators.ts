import type { DatabaseSync } from "node:sqlite";
import { deliveriesSince } from "./clock.ts";
import { all, get } from "./db.ts";

export type CreatorMatch = {
  id: string;
  name: string;
  niche_score: number;
  latest_reach: number;
  deliveries_90d: number;
};

export type CreatorPage = {
  campaign_id: string;
  total: number;
  creators: CreatorMatch[];
};

type CampaignRow = { id: string; niches_json: string };
// Mesmo desempate da implementação original: comparação de string do JavaScript
// (unidades UTF-16). O ORDER BY do SQLite compara bytes UTF-8 e diverge, por
// exemplo, entre U+E000 e U+10000.
function compareCreators(left: CreatorMatch, right: CreatorMatch): number {
  if (right.niche_score !== left.niche_score) return right.niche_score - left.niche_score;
  if (right.latest_reach !== left.latest_reach) return right.latest_reach - left.latest_reach;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

type ScoredRow = {
  id: string;
  name: string;
  niche_score: number | bigint;
  latest_reach: number | bigint;
  deliveries_90d: number | bigint;
};

// Uma ida ao banco para a campanha e outra para a lista inteira, já pontuada e
// ordenada. O número de queries não cresce com a quantidade de criadores.
const LIST_SQL = `
SELECT id, name, niche_score, latest_reach, deliveries_90d
FROM (
  SELECT
    c.id,
    c.name,
    (
      SELECT COUNT(*)
      FROM json_each(?) AS campaign_niche
      JOIN json_each(c.niches_json) AS creator_niche
        ON creator_niche.value = campaign_niche.value
    ) AS niche_score,
    COALESCE(reach.latest_reach, 0) AS latest_reach,
    COALESCE(recent.deliveries_90d, 0) AS deliveries_90d
  FROM creators AS c
  LEFT JOIN (
    -- TOTAL soma em ponto flutuante, como a soma em JS da versão anterior; SUM
    -- devolve inteiro de 64 bits e o driver recusa ler acima do inteiro seguro.
    SELECT sa.creator_id, TOTAL(latest.views) AS latest_reach
    FROM social_accounts AS sa
    JOIN (
      SELECT
        account_id,
        views,
        ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY captured_at DESC, id DESC) AS rn
      FROM metrics
    ) AS latest ON latest.account_id = sa.id AND latest.rn = 1
    GROUP BY sa.creator_id
  ) AS reach ON reach.creator_id = c.id
  LEFT JOIN (
    SELECT creator_id, COUNT(*) AS deliveries_90d
    FROM deliveries
    WHERE delivered_at >= ?
    GROUP BY creator_id
  ) AS recent ON recent.creator_id = c.id
)
WHERE niche_score > 0
`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(
    db,
    "SELECT id, niches_json FROM campaigns WHERE id = ?",
    input.campaignId,
  );
  if (!campaign) return null;

  const rows = await all<ScoredRow>(db, LIST_SQL, campaign.niches_json, deliveriesSince());
  const scored: CreatorMatch[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    niche_score: Number(row.niche_score),
    latest_reach: Number(row.latest_reach),
    deliveries_90d: Number(row.deliveries_90d),
  }));
  scored.sort(compareCreators);

  return {
    campaign_id: input.campaignId,
    total: scored.length,
    creators: scored.slice(input.offset, input.offset + input.limit),
  };
}
