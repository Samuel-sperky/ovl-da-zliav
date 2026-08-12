/**
 * Aura Zľavy — `POST /api/queue/resume` (KONTRAKT V3: K2; odpoveď 43;
 * kontrakt dokončenia B6, akceptačné kritérium 6).
 *
 * TOTO JE TLAČIDLO „POKRAČOVAŤ". Robí presne dve veci a obe sú vedomý klik
 * človeka, nikdy nie automatika:
 *
 *   1. **Otvorí bránu fronty po odstávke počítača** (`scheduler/pause.ts`).
 *      Appka beží na pracovnom počítači, ktorý sa vypína; po prebudení sa
 *      fronta zámerne NEROZBEHNE sama, lebo nevie, čo sa medzitým v shope
 *      stalo. Otvoriť ju smie jedine človek — a jediné miesto, kde sa to smie
 *      stať, je táto route.
 *   2. **Vráti do fronty prepadnuté zľavy** (`missed` → `queued`). Používateľ
 *      po zapnutí počítača nevie, koľko ich prepadlo, a klikať ich po jednej by
 *      bolo absurdné. `queued` znamená „čaká na rad", nie „zapisuje sa teraz" —
 *      samotný zápis rieši scheduler v rámci denného rozpočtu, so všetkými
 *      guardmi, ktoré preň platia (K2).
 *
 * BOD 1 TU DLHO CHÝBAL a je to celý rozdiel medzi „tlačidlo funguje" a
 * „tlačidlo nič nerobí": brána sa zatvorí pri prvom ticku po odstávke a nikto
 * iný ju neotvára. Bez tohto volania fronta stála až do reštartu procesu, hoci
 * odpoveď route hlásila `ok: true`.
 *
 * ČO TÁTO ROUTE ZÁMERNE NEROBÍ
 * ----------------------------
 *   - nezapisuje do shopu (nevolá executor ani `setReduction`),
 *   - neposúva okno platnosti (I7 — appka zľavu nikdy neskracuje),
 *   - nedvíha denný rozpočet ani neobchádza runaway poistku,
 *   - **neodomkne zľavu, ktorá čaká na KĽÚČ.** Kampani v `needs_key` nechýba
 *     potvrdenie, ale kľúč — a ten sa nedá „pokračovať". Miešalo by sa to len
 *     zdanlivo: tlačidlo by hlásilo úspech a nič by sa nepohlo. Namiesto toho
 *     odpoveď POVIE, koľko zliav na kľúč čaká a kam ísť. Vloženie nového kľúča
 *     ich dopáli samo (D24, `PUT /api/key`), bez straty postupu a bez nového
 *     potvrdenia — položky si držia svoj stav a `confirm_payload_hash` na
 *     kampani ostáva, takže I3 zostáva doložené tým istým náhľadom.
 *
 * POCTIVÁ POZNÁMKA K BRÁNE
 * ------------------------
 * Brána je IN-PROCESS stav a Next.js kompiluje `instrumentation` do vlastného
 * module grafu, takže objekt, ktorý vidí táto route, nemusí byť ten istý, aký
 * vidí tick schedulera. Preto sa vracia `gate` s `bestEffort: true` — UI ju
 * nesmie brať ako dôkaz, že fronta beží; dôkazom je až heartbeat a rastúce
 * čísla v `GET /api/queue`. Trvalé riešenie (stĺpec v `settings`) je požiadavka
 * na V7.
 *
 * Vlastník: V8 (dopísané po náleze V13 — klient `resumeQueue()` volal cestu,
 * ktorá neexistovala, takže tlačidlo „Pokračovať" dostávalo 404).
 */
import { AuditEvent } from '@/lib/audit/events';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { getQueueGate, resumeQueue, type QueueGate } from '@/lib/scheduler/pause';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../campaigns/_shared';

/** Kam v appke vedie riešenie „čaká sa na kľúč". */
const KEY_PATH = '/nastavenia';

/** Koľko prepadnutých zliav sa naraz vráti do fronty. */
const MISSED_PAGE = 100;

/** Koľko zliav čakajúcich na kľúč sa vymenuje v odpovedi. */
const NEEDS_KEY_PAGE = 100;

export interface QueueResumeDeps {
  /** Best-effort otvorenie brány — viď poznámku v hlavičke súboru. */
  openGate?: () => void;
  gate?: () => QueueGate;
}

export function createQueueResumePost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
  gateDeps: QueueResumeDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  const openGate = gateDeps.openGate ?? resumeQueue;
  const readGate = gateDeps.gate ?? getQueueGate;

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      /**
       * JEDEN KLIK JE AŽ ~200 ZÁPISOV DO DB: sto `requeueMissed()` a sto
       * záznamov do `audit_log`, ktorý je append-only (I4) — teda sa nedajú
       * zmazať. Držané tlačidlo alebo cyklus v skripte tým vie zaplniť audit
       * a vyprázdniť pool spojení presne vtedy, keď má fronta zapisovať.
       *
       * Fronta sa pritom rýchlejšie nerozbehne tým, že sa klikne desaťkrát:
       * brána je otvorená po prvom klike a zvyšné volania len znovu prejdú
       * ten istý zoznam. Šesť za minútu je priestor na „nefungovalo to, skúsim
       * ešte raz" a zároveň strop, ktorý audit neutopí.
       */
      rateLimit: { limit: 6, windowMs: 60_000, bucket: 'queue-resume' },
      handler: (ctx) =>
        withRouteErrors(async () => {
          /* 1. Brána. Otvára sa PRVÁ: keby sa najprv vracali kampane do fronty
           * a otvorenie brány potom zlyhalo, kampane by čakali v `queued` pred
           * zavretou bránou a nikto by nevedel prečo. */
          const gateBefore = readGate();
          openGate();

          /* 2. Prepadnuté zľavy späť do fronty. Stránkujeme naschvál vysoko:
           * po dlhšej odstávke môže prepadnúť viac zliav naraz a tichý strop by
           * časť z nich nechal ležať. */
          const missed = await d.campaignsRepo.list({
            status: 'missed',
            page: 1,
            perPage: MISSED_PAGE,
          });

          const resumed: number[] = [];
          for (const campaign of missed.data) {
            // Jeden atomický UPDATE (I12): keď medzitým stav zmenil niekto
            // iný — scheduler, druhá karta prehliadača — vráti false a my ho
            // preskočíme. Žiadny SELECT-a-potom-UPDATE.
            const requeued = await d.campaignsRepo.requeueMissed(campaign.id);
            if (!requeued) continue;
            await d.audit.appendAudit({
              actor: 'user',
              userId: ctx.claims.sub,
              eventType: AuditEvent.QUEUE_RESUMED,
              campaignId: campaign.id,
              ok: true,
            });
            resumed.push(campaign.id);
          }

          /* 3. Čo sa týmto tlačidlom NEPOHLO: zľavy, ktorým chýba kľúč.
           * Odpoveď to musí povedať sama — inak používateľ klikne, uvidí
           * „hotovo" a bude čakať na frontu, ktorá stojí na niečom inom. */
          const waitingForKey = await d.campaignsRepo.list({
            status: 'needs_key',
            page: 1,
            perPage: NEEDS_KEY_PAGE,
          });

          /* 4. Keď sa nevrátila ani jedna zľava, aspoň otvorenie brány je vecou,
           * ktorá sa stala — a append-only audit (I4) je jediné miesto, kde to
           * po reštarte procesu ešte niekto uvidí. */
          if (resumed.length === 0 && gateBefore.paused) {
            await d.audit.appendAudit({
              actor: 'user',
              userId: ctx.claims.sub,
              eventType: AuditEvent.QUEUE_RESUMED,
              ok: true,
              message:
                'Fronta odblokovaná po odstávke počítača; žiadna zľava sa do fronty vracať nemusela.',
            });
          }

          const gateAfter = readGate();
          const waiting = waitingForKey.total;

          // Vracia sa HOLÉ dáta, nie vlastná `Response`: obálku `{ok,data}`,
          // povinnú redakciu (I1) aj `no-store` hlavičky doplní `defineRoute()`.
          // Pôvodná verzia si `Response` skladala sama, a tým obchádzala oboje.
          return {
            resumed: resumed.length,
            campaignIds: resumed,
            /** Stav brány PO kliknutí. Best-effort, viď hlavičku súboru. */
            gate: { ...gateAfter, bestEffort: true as const },
            /** Bola brána pred kliknutím zatvorená? Odpoveď na „urobilo to niečo?". */
            gateWasPaused: gateBefore.paused,
            /**
             * Čo sa týmto tlačidlom NEPOHLO a čo s tým.
             *
             * Pole sa NESMIE volať `waitingForKey` ani nijako inak s koncovkou
             * „key": centrálny redaktor (I1) maskuje každé takéto pole CELÉ, aj
             * keď v ňom sú len počty a slovenská veta. Odpoveď by potom
             * obsahovala `"***REDACTED***"` a klient by o zľavách čakajúcich na
             * kľúč nevedel nič — presne ten druh chyby, ktorý sa hľadá hodinu.
             */
            notResumed: {
              /** Kód dôvodu; vetu k nemu nesie `what`/`nextStep` (K10). */
              reason: 'key_missing' as const,
              count: waiting,
              campaignIds: waitingForKey.data.map((c) => c.id),
              what:
                waiting === 0
                  ? 'Na kľúč nečaká ani jedna zľava.'
                  : `${formatCountSk(waiting)} ${pluralSk(waiting, 'zľava čaká', 'zľavy čakajú', 'zliav čaká')} na kľúč na zápis — tlačidlo „Pokračovať" ich nerozbehne, chýba im kľúč, nie potvrdenie.`,
              nextStep:
                waiting === 0
                  ? 'Netreba robiť nič.'
                  : 'Vložte platný kľúč v Nastaveniach; zľavy sa rozbehnú samy tam, kde stoja — postup sa nestratí a nové potvrdenie sa nevyžaduje.',
              path: waiting === 0 ? null : KEY_PATH,
            },
          };
        }),
    },
    routeDeps,
  );
}

export const POST = createQueueResumePost();
