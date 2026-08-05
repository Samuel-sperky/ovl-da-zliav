/**
 * Aura Zľavy — transakcie (§3, D63, D84).
 *
 * `withTransaction()` je jediná cesta, ako spustiť viac príkazov atomicky.
 * Rollback prebehne pri akejkoľvek výnimke, spojenie sa vždy vráti do poolu.
 *
 * Pozor: nad `audit_log` smie transakcia robiť VÝHRADNE `INSERT` (I4) —
 * `UPDATE`/`DELETE` nemá aplikačný DB user ani grantnuté (D74).
 */
import type { PoolConnection } from 'mariadb';

import { getConnection } from '@/db/pool';

export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        // Rollback zlyhal (napr. spadnuté spojenie) — pôvodná chyba je dôležitejšia.
      }
      throw error;
    }
  } finally {
    conn.release();
  }
}

/**
 * Spustí `fn` v existujúcej transakcii, ak je spojenie dodané, inak si otvorí
 * vlastnú. Repozitáre tak vedia bežať aj samostatne, aj ako súčasť dávky.
 */
export async function inTransaction<T>(
  conn: PoolConnection | undefined,
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  if (conn) return fn(conn);
  return withTransaction(fn);
}
