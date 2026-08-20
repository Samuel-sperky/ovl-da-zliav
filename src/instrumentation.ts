/**
 * Aura Zľavy — Next.js instrumentation hook (BUILD-SPEC §11, I14).
 *
 * Next.js kompiluje `instrumentation.ts` pre OBA runtimy (nodejs aj edge).
 * Boot assertions potrebujú `node:fs`, `process.cwd()`, `process.exit()`
 * a DB pool — nič z toho v Edge Runtime neexistuje a build by zlyhal.
 * Preto je tu len tenký dispatcher a celá implementácia žije v
 * `src/instrumentation-node.ts`, ktorý sa načíta VÝHRADNE v Node runtime
 * (dokumentovaný postup Next.js pre node-only instrumentáciu).
 *
 * Assertions a ich poradie sú v `instrumentation-node.ts`; keď ktorákoľvek
 * zlyhá, proces skončí nenulovým kódom (I14) — appka NESMIE bežať
 * v degradovanom režime, v ktorom by mohla zapisovať.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const bootstrap = await import('./instrumentation-node');
  await bootstrap.register();
}
