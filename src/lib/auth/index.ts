/**
 * Aura Zľavy — barrel priečinka `lib/auth`.
 *
 * Do 27. 8. 2026 tu bolo prihlásenie: session (D69), heslá (D68), lockout (D71)
 * a sudo (D70). Všetko sa zmazalo (D99, D100) — appka je jednoužívateľský
 * lokálny nástroj a tri vrstvy toho istého hesla boli trenie, nie ochrana.
 * Rozbor a prijaté riziko: KONTRAKT-BEZ-LOGINU-2026-08-27.md.
 *
 * Zostala jediná otázka, ktorú tento priečinok odpovedá: **kto to zapísal.**
 * Nie kvôli bezpečnosti — kvôli FK na `users(id)` a kvôli auditu (I11).
 */
export {
  FRESH_INSTALL_USERNAME,
  NO_LOGIN_SENTINEL,
  findLocalActor,
  localActor,
  localActorMissingError,
  resetLocalActorCache,
  resolveLocalActor,
  type LocalActorDeps,
} from '@/lib/auth/local-actor';
