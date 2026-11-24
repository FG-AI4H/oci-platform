import { Prisma, type PrismaClient } from '@oci/database';

/** Either the client or an interactive transaction. */
type Db = Pick<PrismaClient, '$queryRaw'>;

/**
 * Serialises, per campaign, the router's "count the free slots, then
 * take one" (#646 review, item 1). Under READ COMMITTED with no lock,
 * readers who press Start together all count the same free slots and
 * all take them: 8 parallel pulls on a task needing 3 readers made 8
 * assignments. With the lock, each pull's reads start after the
 * previous pull committed, so the count it sees is the one it fills.
 *
 * Raw because Prisma has no advisory-lock API. Held until the
 * transaction ends, so it must be taken inside the pull transaction,
 * before its first read. The key is a bound parameter.
 */
export async function lockCampaignPulls(db: Db, campaignId: string): Promise<void> {
  // The lock function returns `void`, which the driver cannot read
  // back: select a constant beside it.
  await db.$queryRaw(
    Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`annotation-pull:${campaignId}`}, 0))) AS l`,
  );
}
