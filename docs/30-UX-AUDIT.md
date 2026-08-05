# Aura Zľavy — UX AUDIT

**Dátum:** 2026-08-05 · **Rozsah:** snímky `screenshots/01–13`, `src/components/**`, `src/app/**`
**Referencie:** `docs/10-KONTRAKT.md` (R1–R10, D1–D100, I1–I14)
**Charakter dokumentu:** analýza. Nič sa neimplementovalo, nič sa neupravovalo.

Používateľ je jeden expert (Samuel), ktorý appku používa **opakovane** a mení ňou
**reálne ceny**. Preto sú kritériá tohto auditu: (a) koľko práce ho stojí rutinná
kampaň, (b) či po chybe vie, čo sa stalo a čo má urobiť, (c) či ho niečo chráni
pred omylom bez toho, aby mu to prekážalo.

---

## Zistenia

### U1 — „Dopáliť teraz (cez dry-run)" pri `needs_key`/`missed` sa nedá dokončiť

**Problém.** Jediná cesta, ktorou sa podľa D33b dá zmeškaná alebo na kľúč
čakajúca kampaň dopáliť, v UI zlyhá — a v každom z dvoch prípadov inak:

1. `missed` kampaň má `date_from` **v minulosti** (to je definícia zmeškania).
   `CampaignDetail.startExecuteDryRun()` posiela do dry-runu `from: c.dateFrom`
   (`src/components/campaigns/CampaignDetail.tsx:105–112`), teda minulý deň.
   `buildPreview()` na to nasadí blokátor `from_in_past`
   (`src/lib/engine/preview.ts:98–108` → `campaign-rules.ts:75–83`).
   Pri blokátore sa `ConfirmPanel` vôbec nevykreslí (`CampaignDetail.tsx:217–235`),
   zostane len tlačidlo „Zavrieť". **Slepá ulička.**
2. `needs_key` kampaň s budúcim `from` blokátor nedostane, ale dry-run vydá token
   s `kind: 'retry'`, kým `POST /api/campaigns/[id]/execute` overuje token proti
   `kind: campaign.kind` (`src/app/api/campaigns/[id]/execute/route.ts:85–91`).
   `kind` je súčasťou `payloadHash` (`src/lib/crypto/preview-token.ts:137–147`),
   takže overenie padne na `payload_mismatch` → 400 `preview_token_invalid`.
   Server pritom očakáva token vydaný na `effectiveFrom` (posunuté `from`, D25),
   nie na pôvodné (`execute/route.ts:76`).

Testy to nezachytia, pretože obchádzajú `/preview` a token si vydávajú priamo —
komentár v `test/integration/routes-campaigns.spec.ts:207–212` to výslovne píše.

**Dôkaz.** `CampaignDetail.tsx:101–116`, `execute/route.ts:56–93`,
`preview.ts:97–108`, `routes-campaigns.spec.ts:190–275`; snímka `03-dashboard.png`
(Wolfrám −12 %, zmeškaná, okno 03.08.–19.08., dnes 05.08.).

**Dopad: vysoký.** Zmeškaná kampaň je stav, ktorý D33b zámerne vytvoril a
označil za rovnako naliehavý ako `needs_key` — a jediná cesta z neho nefunguje.
Samuel má na dashboarde červený banner „vyžadujú tvoj zásah (2)" a v detaile
nemá čo urobiť.

**Riešenie.**
1. V `startExecuteDryRun()` počítať `effectiveFrom = max(c.dateFrom, dnes)` a
   posielať `kind: c.kind` (nie `'retry'`).
2. Pred spustením dry-runu zobraziť, čo sa s oknom stane: „OD sa posunie z
   03.08.2026 na dnes 05.08.2026, DO zostáva 19.08.2026 — zľava pobeží 15 dní
   namiesto plánovaných 17." (dáta na to sú, `resolveFireWindow()` to počíta).
3. Ak `to < dnes`, tlačidlo „Dopáliť teraz" vôbec nenabízať a namiesto neho
   povedať „Okno skončilo 19.08.2026 — dopáliť sa už nedá, vytvor novú kampaň"
   s tlačidlom, ktoré predvyplní novú kampaň z tejto (viď U8).
4. Doplniť e2e test, ktorý ide **cez `/preview`**, nie cez token service.

---

### U2 — Read-only režim nevypína ani jednu zapisovaciu akciu

**Problém.** D10 žiada: po expirácii kľúča sú zapisovacie akcie *disabled
s tooltipom*. Infrastruktúra existuje a **nikto ju nepoužíva**:

- `READ_ONLY_TOOLTIP` (`layout/ReadOnlyNotice.tsx:14`) má **nulových
  konzumentov** v celom `src/`.
- `useHealth()` používa len hlavička (`HeaderStatus.tsx`) — žiadna stránka
  z nej stav kľúča nečíta.
- `ProductsPanel` renderuje `AddProductForm` a `RefreshButton` **bez** `disabled`
  (`products/ProductsPanel.tsx:52–60`), hoci oba prop podporujú.
- „+ Nová kampaň" je obyčajný `<a href="/kampane/nova">`
  (`CampaignList.tsx:106`) — nedá sa vypnúť.
- „Zapísať do PRODUKCIE" v `ConfirmPanel` sa vypína len pri chýbajúcom `oneDayAck`
  a nedokončenej session (`ConfirmPanel.tsx:92–93`) — nie pri chýbajúcom kľúči
  ani pri `writesLocked`.

Dôsledok pre Samuela: v read-only režime (snímka `12`) prejde celý formulár,
vyberie produkty, percento, dátumy — a dry-run mu padne s hláškou
**„Shop sa nepodarilo prečítať — dry-run sa nedá zostaviť (fail-closed)."**
(`preview.ts:153–157`), ktorá o kľúči nehovorí ani slovo. Skutočná príčina je
`ApiKeyError('expired'/'unavailable')` z `api-key.repo.ts:446–450`, zahltená
`catch`-om.

**Dôkaz.** `preview.ts:148–158`, `ProductsPanel.tsx:45–62`, `CampaignList.tsx:106`,
`ReadOnlyNotice.tsx:14`; snímky `12-dashboard-read-only-po-expiracii.png`, `01-login.png`.

**Dopad: vysoký.** Zbytočne vykonaná práca + zavádzajúca hláška v jedinom
momente, kedy má appka byť maximálne jasná.

**Riešenie.**
1. Jeden hook `useWriteGate()` → `{ canWrite, reason }` z `/api/health`
   (`key.present && !expired && writesEnabled && !writesLocked`).
2. Prejsť všetky zapisovacie CTA a dať im `disabled={!canWrite}` +
   `disabledReason={reason}`; „+ Nová kampaň" premeniť na `<Button>` alebo
   `aria-disabled` odkaz s viditeľným vysvetlením.
3. Chýbajúci/expirovaný kľúč urobiť **vlastným blokátorom** dry-runu
   (`code: 'key_missing'`, hláška „API kľúč chýba alebo expiroval — vlož nový
   v Nastaveniach" + odkaz), nie `shop_unreachable`.
4. Na vrch `/kampane/nova` pridať pruh „Kľúč chýba — dry-run si môžeš prezrieť,
   zapísať sa nedá", ak sa rozhodne, že príprava kampane má byť možná aj bez
   kľúča (viď rozhodnutie R-J).

---

### U3 — Blokátor prekryvu nepovie, ktorá kampaň a ktorý produkt, ani ako to odblokovať

**Problém.** Snímka `08-dry-run-blokovany-prekryv.png`: „Na produkte už existuje
iná budúca kampaň s prekrývajúcim sa oknom — prekryv dvoch budúcich kampaní je
blokovaný (D28). `future_overlap`". V sade sú traja produkty (#201, #202, #203) a
hláška nepovie ani jeden z nich, ani číslo kolidujúcej kampane, ani jej okno.
Jediné tlačidlo je „← Späť na úpravu".

Informácia existuje a **kód ju zámerne zahodí**:

```ts
overlapIds = [...new Set(overlaps.flatMap(...))];
if (overlaps.length > 0) { blockers.push({ code: 'future_overlap', message: '…' }); }
void overlapIds;                        // src/lib/engine/preview.ts:130–139
```

`blocker.productId` sa nenastaví, hoci `PreviewBlocker` ho podporuje a
`DryRunTable` ho vykresľuje (`DryRunTable.tsx:103`). `assertNoFutureOverlap()`
v `campaign-rules.ts:184–200` dokonca vracia plný detail
`{campaignId, productId, from, to, status}` — dry-run túto vetvu nepoužíva.

**Dôkaz.** `preview.ts:119–139`, `campaign-rules.ts:177–200`,
`DryRunTable.tsx:96–108`; snímka `08`.

**Dopad: vysoký.** Zablokovaná hlavná cesta bez inštrukcie. Samuel musí ísť do
`/kampane`, ručne prehľadať naplánované kampane a domyslieť si, ktorá koliduje.

**Riešenie.**
1. Vrátiť prekryvy do blokátora: `{ code:'future_overlap', productId,
   detail:{ campaignId, name, from, to } }` pre **každý** kolidujúci produkt.
2. Vykresliť ako vetu s odkazom: „Šperk 1 (#201) už má naplánovanú kampaň
   [#86 Vianoce −25 %] na 19.09.2026 – 19.10.2026."
3. Dve konkrétne akcie priamo v blokátore:
   - **„Vyradiť #201 z tejto sady"** (jeden klik → odškrtne produkt a znova
     spustí dry-run),
   - **„Otvoriť kampaň #86"** (nový tab / návrat).
4. Z hlášky vypustiť `(D28)` aj surový kód do hlavného textu (viď U9);
   `future_overlap` nechať v rozbaľovacom „Technický detail".

---

### U4 — Dashboard varuje až po fakte; pripomienky 48/24/2 h sa počítajú a nikde nezobrazia

**Problém.** D26 žiada banner „vlož kľúč pre kampaň X" **48 h, 24 h a 2 h pred
spustením**. `src/lib/scheduler/reminders.ts` ich korektne počíta a odloží do
`setActiveReminders()`. Komentár na riadku 5–6 tvrdí, že si ich číta
`/api/notifications` a dashboard banner. **Ani jedno nie je pravda:**
`getActiveReminders()` má nulových konzumentov v `src/` (jediné výskyty sú v
`test/integration/scheduler.spec.ts`), `/api/notifications` vracia výhradne
`unacked` (`api/notifications/route.ts:29–38`).

`AlertsBanner` agreguje len `needs_key` + `missed` (`AlertsBanner.tsx:20–46`) —
teda stavy, do ktorých sa kampaň dostane, **až keď už zlyhala**. D8 pritom žiada,
aby v banneri boli *„všetky ohrozené kampane"*, výslovne vrátane kampaní
naplánovaných za horizont platnosti kľúča.

Na snímke `03` je „Vianoce −25 % (naplánované)" na 19.09.2026 a kľúč vydrží
47 h 59 min. Nikde na dashboarde nie je varovanie, že sa táto kampaň bez zásahu
19.09. neuskutoční.

**Dôkaz.** `reminders.ts:47–58`, `api/notifications/route.ts:29–38`,
`AlertsBanner.tsx:20–46`, `health/route.ts` (kľúč iba `present`/`expiresAt`);
snímka `03-dashboard.png`.

**Dopad: vysoký.** Appka má všetky dáta na to, aby zlyhaniu predišla, a namiesto
toho ho oznámi po ňom.

**Riešenie.**
1. `/api/notifications` rozšíriť o `reminders` (z `getActiveReminders()`) a
   o `atRisk` — kampane `scheduled`, kde `fireAt > key.expiresAt`.
2. Do `AlertsBanner` (alebo nad ňu) druhá sekcia **„Chystá sa"**: „Kampaň #86
   Vianoce −25 % sa zapíše 19.09.2026 00:05. Kľúč expiruje 07.08.2026 — bez
   nového kľúča skončí v stave „vyžaduje kľúč"." Tón podľa pásma (48 h neutrál,
   24 h výstraha, 2 h kritická).
3. Rovnaké varovanie ukázať už pri vytváraní kampane — `warnings.keyExpiresBeforeStart`
   sa v dry-rune počíta (`preview.ts:233–245`) a `DryRunTable.tsx:111–115` ho
   zobrazuje, ale bez čísla („expiruje skôr" — nepovie kedy a o koľko).

---

### U5 — Dátumové polia zobrazujú `mm/dd/yyyy`, čo je pri zmene cien reálne riziko zámeny

**Problém.** Snímka `07-nova-kampan-vyplnena.png`: „Od `08/06/2026`  Do
`09/05/2026`". Natívny `<input type="date">` sa formátuje podľa locale
prehliadača, nie podľa jazyka appky. D13 pritom normuje: *„všetky dátumy sa
MUSIA zobrazovať vo formáte DD.MM.YYYY"*. `08/06/2026` je 6. augusta aj
8. júna — a rozdiel je „zľava beží teraz" verzus „zľava beží za dva mesiace".

Nikde v kroku 1 sa navyše nezobrazuje **dĺžka okna** ani interpretácia dátumov
slovami. `DateRangePicker` má len vetu „Zľava platí od 00:00 dňa OD do 23:59 dňa
DO, čas shopu" (`DateRangePicker.tsx:13–14`), ktorá hovorí o hranicách dňa, nie
o konkrétnych dňoch. Presety `7/14/30 dní` majú správny dátum len v `title`
tooltipe (`DateRangePicker.tsx:70`).

**Dôkaz.** `DateRangePicker.tsx:39–61`, `ExtendDialog.tsx:82–89`,
`AuditFilters.tsx:56–74`; snímky `06`, `07`, `10`.

**Dopad: vysoký.** Zámena dátumu je najtypickejší omyl v tomto type nástroja a
zaplatí sa ostrým zápisom.

**Riešenie.**
1. Pod (alebo za) každý picker vypísať interpretovaný dátum textom:
   `= 06.08.2026 (št)`.
2. Nad primárne CTA jednu súhrnnú vetu: **„Zľava −15 % pobeží 06.08.2026 –
   05.09.2026 · 31 dní · 3 produkty."** Tá istá veta patrí do `ConfirmPanel`
   (dnes tam je bez počtu dní, `ConfirmPanel.tsx:165–170`).
3. Presety označiť výsledným dátumom v labeli, nie v tooltipe („30 dní → 04.09.").

---

### U6 — Počítadlá položiek nesedia a „Zopakovať zlyhané" ticho vynecháva nenájdené produkty

**Problém.** Snímka `05-kampan-detail-ciastocne-zlyhanie.png`:

- Hlavička hovorí „Položky: **2 ok · 1 zlyhané · 0 neisté · spolu 5**".
  2 + 1 + 0 = 3, spolu je 5. Chýbajúce dva stavy (`nenájdený`, `preskočený`) nemajú
  v súhrne kolónku (`CampaignDetail.tsx:155–158`). To isté v zozname kampaní:
  stĺpec „Položky (ok/zlyhané/spolu)" = `2/1/5` (`CampaignList.tsx:88–93`).
- Tlačidlo hlási **„Zopakovať zlyhané (2)"**, hoci ne-OK položky sú tri.
  `RETRYABLE_ITEM_STATUSES` je `['failed','uncertain','interrupted','skipped']`
  (`ItemsTable.tsx:18`) — `not_found` v ňom **správne** nie je (zapísať sa nedá),
  ale UI to nikde nepovie. Šperk 205 tak zostane trvalo nedopísaný a Samuel sa
  o tom dozvie len tak, že si spočíta riadky.

**Dôkaz.** `CampaignDetail.tsx:155–158`, `ItemsTable.tsx:17–24`,
`RetryFailedButton.tsx:48,98`, `CampaignList.tsx:88–93`; snímka `05`.

**Dopad: vysoký.** Pri čiastočnom zlyhaní je jediná otázka „čo ešte nie je
hotové" — a odpoveď je nesprávna aj neúplná.

**Riešenie.**
1. Súhrn rozpísať kompletne: `2 zapísané · 1 zlyhaný · 1 nenájdený ·
   1 preskočený · 0 neistých · spolu 5`. V zozname stĺpec premenovať na
   „hotové / ostáva" (`2/3`) a plný rozpis dať do tooltipu.
2. Pod tlačidlo retry doplniť vetu o vynechaných: **„Šperk 205 (#205) sa v shope
   nenašiel — opakovanie ho nezahrnie. Over ID v admine shopu alebo produkt
   odober z allowlistu."** + odkaz na `/produkty`.
3. Presunúť „Zopakovať zlyhané" nad tabuľku položiek (dnes je až pod ňou, kým
   „Beriem na vedomie výsledok" je hore — priority sú obrátené).

---

### U7 — Pri „rozhodoval si nad inou cenou" appka nedopočíta, aká cena teda platí

**Problém.** D39c vedome pripustil, že sa cena medzi dry-runom a zápisom môže
zmeniť, a ako protiváhu vyžaduje viditeľný príznak. Príznak tam je
(`ItemsTable.tsx:58–62`, `AuditDetailDrawer.tsx:80–88`), ale Samuel z neho
nevyčíta to, čo potrebuje. Snímka `05`: `1 999,00 € → 2 199,00 €` + badge
„rozhodoval si nad inou cenou".

Appka pozná percento aj obe ceny — orientačnú výslednú cenu teda vie spočítať a
neurobí to. Samuel musí ručne počítať, o akú zľavu v eurách vlastne ide.

**Dôkaz.** `ItemsTable.tsx:50–65`, `AuditDetailDrawer.tsx:80–89`; snímka `05`.

**Dopad: vysoký** (pri produkte za 2 199 € je omyl v desiatkach eur).

**Riešenie.** V riadku aj v audit detaile doplniť: „Potvrdil si −20 % z 1 999 €
(≈ 1 599 €). Zapísalo sa −20 % z 2 199 € → **≈ 1 759 €**, o 160 € viac."
Použiť existujúci `PriceHint` s cenou `priceAtWrite`.

---

### U8 — Opakovaná práca nemá ani jednu skratku

**Problém.** Referenčná úloha „daj −15 % na 5 produktov od zajtra na mesiac":

| # | krok | interakcií |
|---|---|---|
| 1 | nav → Kampane | 1 |
| 2 | „+ Nová kampaň" | 1 |
| 3 | odškrtnutie 5 produktov | 5 |
| 4 | čip „15 %" | 1 |
| 5 | zmena OD na zajtra (dnes je predvolené) | 2–3 |
| 6 | preset „30 dní" | 1 |
| 7 | „Pokračovať na dry-run" | 1 |
| 8 | „Zapísať do PRODUKCIE" | 1 |
| 9 | sudo heslo + Potvrdiť (ak > 15 min) | 2 |
| | **celkom** | **13–16** |

Z toho 5 klikov je **opakované odškrtávanie tej istej sady produktov** pri každej
kampani. Chýba:

- **„Duplikovať kampaň"** — najväčšia strata. Ani v detaile, ani v zozname.
- Predvyplnenie z existujúcej kampane. `ExtendDialog.tsx:101` odkazuje na
  `/kampane/nova?prepis=${campaign.id}`, ale `NewCampaignWizard` **žiadny query
  parameter nečíta** (`nova/page.tsx`, `NewCampaignWizard.tsx:43–63`) — odkaz
  vedie na prázdny formulár a všetko sa zadáva odznova. Mŕtvy odkaz.
- „Vybrať všetko / nič" a „posledná použitá sada" v kroku 1.
- Preset pre **OD** (dnes/zajtra/od 1. dňa mesiaca) — presety existujú len pre DO
  (`DateRangePicker.tsx:29–34`).
- Preset „1 mesiac" / „3 mesiace". `30 dní` z 06.08. dá 04.09., nie 06.09.
- Vstup do „Novej kampane" z dashboardu — dashboard **nemá žiadne CTA**
  (`Dashboard.tsx:83–101`, snímka `03`). Vždy o klik viac.
- Klávesové skratky (žiadne `onKeyDown` mimo `PercentInput`).

**Dôkaz.** `NewCampaignWizard.tsx:43–63,209–300`, `nova/page.tsx`,
`ExtendDialog.tsx:99–104`, `Dashboard.tsx:83–101`, `DateRangePicker.tsx:29–34`;
snímky `03`, `04`, `06`, `07`.

**Dopad: stredný až vysoký** (nie riziko, ale trenie pri každej kampani).

**Riešenie.**
1. „Duplikovať" v detaile kampane a v riadku zoznamu → wizard predvyplnený
   produktmi + percentom, okno prázdne (nová kampaň musí mať `from ≥ dnes`).
2. Wizard nech čita `?z=<campaignId>` (a `?prepis=<id>` pre existujúci odkaz)
   a predvyplní sadu; inak ten odkaz z `ExtendDialog` odstrániť.
3. V kroku 1 „Vybrať všetky / žiadne" + tlačidlo „Posledná sada (5)".
4. „+ Nová kampaň" na dashboard (vedľa nadpisu) aj do hlavičky.
5. Presety pre OD: `dnes` / `zajtra` / `1. deň nasl. mesiaca`; pre DO doplniť
   `1 mesiac` a `3 mesiace` (kalendárne, zhodne s validáciou `maxAllowedTo`).

---

### U9 — Čísla rozhodnutí (D28, I11, D60…) v textoch pre používateľa

**Problém.** V textoch, ktoré Samuel číta, je **20 výskytov** interných kódov:

```
DryRunTable.tsx:113 (D8) · :120 (D28) · :126 (D60) · :134 (I11)
ConfirmPanel.tsx:131 (D28) · :148 (I11) · :180 (D30)
NewCampaignWizard.tsx:149 (I11) · :255 (D28) · :264 (D28) · :303 (D2, I3)
CampaignDetail.tsx:171 (I11) · :172 (I7) · :208 (I3)
ItemsTable.tsx:74 (I11) · RetryFailedButton.tsx:106 (D16)
ExtendDialog.tsx:78 (D27) · :102 (D27, D28)
AddProductForm.tsx:102 (I2) · UnlockWritesForm.tsx:82 (D79)
```

Pre používateľa je `(D28)` šum — nevie, čo to je, a nemá kde to dohľadať (kontrakt
nie je v appke). Horšie: kód často stojí **na mieste, kde by mala byť
inštrukcia**. „prekryv dvoch budúcich kampaní je blokovaný (D28)" končí kódom
namiesto vety „zruš pôvodnú kampaň alebo zmeň dátumy" — pričom presne tá veta
v kóde existuje (`campaign-rules.ts:188`) a do UI sa nedostane.

Nadpisy typu „Dry-run opakovania (nové potvrdenie je povinné, D16)"
(`RetryFailedButton.tsx:106`) a „Dry-run dopálenia (nové potvrdenie je povinné, I3)"
(`CampaignDetail.tsx:208`) sú polovicou nadpisu o internej norme.

**Žiadne rozhodnutie v kontrakte nevyžaduje, aby kódy boli v UI.** D-čísla sú
nástroj pre agentov, nie pre používateľa.

**Dopad: stredný** (znižuje čitateľnosť práve v kritických hláškach).

**Riešenie.**
1. Odstrániť kódy zo všetkých 20 miest; nechať ich v komentároch a v `data-*`
   atribútoch (testy sa o ne môžu opierať).
2. Kde má text vysvetliť „prečo", napísať to po ľudsky: „Dve naplánované zľavy
   na jednom produkte appka nepovolí — nedá sa zistiť, ktorá v shope vyhrá."
3. Zaviesť test/ESLint pravidlo, ktoré zhodí build, ak sa v renderovanom
   stringu objaví `/\b[DIR]\d{1,3}\b/`.

---

### U10 — Ten istý disclaimer sa opakuje 3–4× na obrazovke, takže ho nikto nečíta

**Problém.** Snímka `08`, produkt #201 — varovanie o variantoch je **trikrát**:
v ploche produktu (`VariantWarning` v `DryRunTable.tsx:38`), v žltej karte nad
tabuľkou (`DryRunTable.tsx:123–128`) a v stĺpci „Upozornenia"
(`preview.ts:190–195`).

Veta „orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť" je na **každom
riadku** (`PriceHint`), znova na každom riadku v „Upozorneniach"
(`preview.ts:202` pridáva `DISCOUNTED_PRICE_DISCLAIMER_SK` do `item.warnings`)
a ešte raz ako pätička (`DryRunTable.tsx:132–135`).

Badge „bez vlastného zápisu — shop môže mať iný stav" je na všetkých 9 kartách
dashboardu, na všetkých 9 riadkoch allowlistu, na všetkých riadkoch dry-runu aj
vo výbere produktov v kroku 1 — pri produktoch, ktoré **žiadny stav zľavy
nezobrazujú** (snímky `03`, `06`, `09`).

**Dopad: stredný.** Priznanie neistoty je správne rozhodnutie (I11), ale
v takejto koncentrácii sa mení na tapetu a prestane fungovať práve tam, kde
naozaj varuje (produkt s variantmi, prepis existujúcej zľavy).

**Riešenie.**
1. Vypustiť `DISCOUNTED_PRICE_DISCLAIMER_SK` z `item.warnings` (`preview.ts:202`)
   — `PriceHint` disclaimer už drží, takže D4 zostáva splnené.
2. Varovanie o variantoch nechať **len raz** — v riadku produktu, ktorého sa
   týka; agregovanú kartu nahradiť počtom („2 produkty majú varianty").
3. Stĺpec „Upozornenia" v dry-rune používať výhradne na to, čo je **pre daný
   riadok odlišné**; keď nič, `—`.
4. `SelfWriteBadge` pri `writtenAt == null` nevykresľovať badge, len `—`
   (pozor, koliduje s D7 — viď sekciu „Koliduje…").

---

### U11 — Citlivé akcie žiadajú to isté heslo dvakrát

**Problém.** `DomainForm`, `UnlockWritesForm` a `PanicButton` majú vlastné pole
„Heslo". Server pri neplatnom sudo okne vráti `sudo_required`, UI otvorí
`SudoPrompt`, ktorý si **vyžiada to isté heslo znova**, a potom zopakuje
pôvodný request s heslom z formulára:

```ts
if (res.error.code === SUDO_REQUIRED_CODE) { setNeedSudo(true); return; }   // DomainForm.tsx:63–66
…
<SudoPrompt onSuccess={() => { setNeedSudo(false); void save(); }} />        // DomainForm.tsx:160–169
```

Panic button je najhorší prípad: heslo → doslovné prepísanie `KLUC UNIKOL` →
heslo znova (`PanicButton.tsx:120–144,174–188`). Trojité potvrdenie na akcii,
ktorej celou pointou je **rýchlosť** („kľúč unikol").

Naopak pri odobraní produktu z allowlistu nie je potvrdenie žiadne (viď U14) —
trenie je rozdané opačne, než by malo byť.

**Dôkaz.** `DomainForm.tsx:40–70,160–169`, `UnlockWritesForm.tsx:35–60,111–125`,
`PanicButton.tsx:50–81,174–188`, `ApiKeyForm.tsx:69–73,160–174`; snímky `02`, `11`.

**Dopad: stredný.**

**Riešenie.** Zjednotiť na jednu cestu (výber je rozhodnutie, viď R-A):
buď heslo z formulára server prijme ako sudo re-auth a sudo okno obnoví v tom
istom requeste (endpointy `password` už berú), alebo formulárové pole zmizne a
`SudoPrompt` je jediné miesto, kde sa heslo zadáva.

---

### U12 — Sudo okno je neviditeľné a prekvapí uprostred zápisu

**Problém.** `sudoSecondsLeft()` (`lib/auth/sudo.ts:98–102`) má v komentári
„Pre UI odpočet" a **nulových konzumentov**. `ConfirmPanel` stav sudo zisťuje až
pri kliknutí (`ConfirmPanel.tsx:101–110`), takže dialóg s heslom vyskočí
v momente, keď Samuel čaká zápis. V hlavičke je odpočet kľúča (D5), odpočet
session ani sudo okna nikde — pritom session má 30 min idle a 8 h absolútnu
platnosť (D69).

**Dopad: stredný** (prekvapenie v najcitlivejšom okamihu; pri dlhšej dávke
riziko, že sudo vyprší medzi dvoma zápismi).

**Riešenie.**
1. Badge v hlavičke: „heslo platné ešte 12 min" (výstražná farba pod 2 min),
   vedľa badge kľúča.
2. V `ConfirmPanel` **pred** kliknutím: „Zápis si vyžiada heslo (sudo okno
   vypršalo)" — nech to Samuel vie skôr, než tlačidlo stlačí.
3. Ponúknuť „Predĺžiť sudo okno" jedným klikom pred dávkou viacerých kampaní.

---

### U13 — Audit sa nedá deep-linkovať a kampaň naň nemá odkaz

**Problém.**
- `/audit` drží filtre iba v lokálnom state (`AuditPanel.tsx:24`); `toQuery()`
  skladá len query pre API (`audit/api.ts:102–113`). Do URL sa nič nedostane →
  žiadny odkaz „audit tejto kampane / tohto produktu" nie je možný a stav sa
  stratí pri refreshi.
- Detail kampane má sekciu „Audit stopa" a na snímke `05` je **prázdna**
  („Žiadne audit záznamy."), pričom `/audit` (snímka `10`) obsahuje tri
  `reduction_set` záznamy pre produkty 201 a 204 — so stĺpcom **KAMPAŇ „—"**.
  Query filtruje podľa `campaignId` (`api/campaigns/[id]/route.ts:34`), takže
  bez `campaign_id` na zápisových eventoch je stopa nedosiahnuteľná.
- `CampaignItemView.requestId` existuje (`campaigns/api.ts:106`) a `ItemsTable`
  ho **nikdy nevykreslí**. Skorelovať položku so záznamom v audite sa dá len
  očami.
- `/api/allowlist` zahodí `campaignId` z `lastOwnWrite`, hoci repo ho vracia
  (`api/allowlist/route.ts:52–58` vs `campaigns.repo.ts:391–403`). Odpoveď na
  „ktorá kampaň nastavila túto zľavu" sa dá zistiť len preklikaním kampaní.

**Dopad: stredný** (audit je pri produkčných zápisoch hlavný nástroj
dohľadávania; dnes je izolovaný ostrov).

**Riešenie.**
1. Filtre `/audit` naviazať na URL (`?campaignId=85&eventType=write_failed`).
2. Odkaz „Otvoriť audit tejto kampane →" v hlavičke „Audit stopa" a
   „záznamy tohto produktu →" v každom riadku položky.
3. `requestId` a `operationId` zobraziť v riadku položky (mono, s kopírovaním).
4. `campaignId` prepustiť v `/api/allowlist` a v allowlistě aj na dashboarde
   spraviť z posledného vlastného zápisu odkaz na kampaň.
5. Overiť, že všetky `reduction_set` / `write_*` eventy majú `campaign_id`.

---

### U14 — Allowlist: odobranie bez potvrdenia, 9× červené tlačidlo, „stav neznámy" bez cesty späť

**Problém.** Snímka `09-produkty-allowlist.png`:

- Stĺpec „Akcie" má na každom riadku **dve plnohodnotné tlačidlá**, jedno z nich
  červené destruktívne. Na stránke je tak 9 červených tlačidiel „Odobrať
  z allowlistu" — vizuálne dominujú obrazovke, ktorej hlavný účel je prehľad.
- `remove()` sa vykoná **okamžite po kliknutí**, bez potvrdenia a bez undo
  (`AllowlistTable.tsx:38–62`). Slot sa uvoľní, produkt sa musí pridávať znova
  podľa ID.
- „Označiť stav ako neznámy" je tiež okamžité; vysvetlenie je len v `title`
  tooltipe (`MarkUnknownButton.tsx:47`) a **nikde nie je napísané, ako sa stav
  vráti** — hoci „Obnoviť z shopu" ho prepne späť na `ok`
  (`api/catalog/refresh/route.ts:109`).
- Chybová hláška pri blokovanom odobraní je dobrá a konkrétna
  (`AllowlistTable.tsx:53–56`), ale nemá odkaz na tú kolidujúcu kampaň — a appka
  ju pozná (`findPlannedForProduct`).

**Dopad: stredný.**

**Riešenie.**
1. Akcie do riadkového menu („…"), destruktívnu položku odlíšiť textom, nie
   plochou.
2. Odobranie s inline potvrdením: „Odobrať Šperk 205? [Odobrať] [Zrušiť]".
3. Pri „stav neznámy" doplniť vetu „Vráti sa cez ‚Obnoviť z shopu'" a badge
   „stav neznámy" spraviť klikateľný na to obnovenie.
4. Do hlášky o blokovanom odobraní pridať odkaz na blokujúcu kampaň.

---

### U15 — Onboarding je nedosiahnuteľný, nedá sa dokončiť a jeho prvý krok zobrazuje zlé dáta

**Problém.** D20 žiada, aby prvé spustenie viedlo onboarding checklistom.
Stránka `/onboarding` existuje a **nič na ňu nevedie**:

- v navigácii nie je (`Nav.tsx:9–15`),
- middleware/redirect neexistuje (`src/` nemá `middleware.ts`),
- `markOnboardingDone()` v repozitári existuje (`settings.repo.ts:122–124`) a
  **žiadna route ju nevolá** → `onboardingDoneAt` zostane navždy `null`, takže
  „prvé spustenie" sa ani nedá rozpoznať.

Prvý krok navyše zobrazuje zlú hodnotu: `DomainForm` inicializuje state
`useState(shopDomain ?? 'https://')` (`DomainForm.tsx:31`), ale onboarding ho
renderuje ešte pred dotiahnutím settings (`onboarding/page.tsx:163–170`), takže
prop dorazí neskôr a state sa **nikdy nesynchronizuje**. Snímka `02`: „aktuálne:
`https://shop.e2e.invalid`" a pole vedľa obsahuje len `https://`. V Nastaveniach
(snímka `11`) je pole správne, pretože `SettingsPanel` renderuje formulár až po
načítaní.

Zároveň krok označený „hotové" ukazuje prázdny formulár s tlačidlom „Uložiť
doménu" — vizuálne to vyzerá ako nedokončená úloha.

**Dopad: stredný** (jednorazová obrazovka, ale prvý dojem a jediné miesto, kde
sa dá bezpečne vyskúšať dry-run bez rizika).

**Riešenie.**
1. `/` presmerovať na `/onboarding`, kým `!shopDomain || !keyPresent ||
   allowlist.length === 0` a `onboardingDoneAt == null`.
2. Po úspešnom testovacom dry-rune zavolať `markOnboardingDone()` a zobraziť
   „Onboarding hotový → Dashboard".
3. `DomainForm` synchronizovať s propom (`useEffect`) alebo renderovať až po
   načítaní settings, ako to robí `SettingsPanel`.
4. Hotové kroky zbaliť („Doména: shop.e2e.invalid ✓ [zmeniť]").

---

### U16 — Nikde nie je vidieť, KEDY sa naplánovaná kampaň zapíše

**Problém.** `fireAt` je v odpovedi API (`_shared.ts:353`, `campaigns/api.ts:80,127`)
a **v UI sa nevykresľuje nikde**: `CampaignList` má stĺpce Kampaň / Stav / Zľava /
Okno / Režim / Položky (`CampaignList.tsx:62–94`), `CampaignDetail` má Zľava /
Okno / Režim / Položky / Potvrdená / Dokončená / Dôvod stavu
(`CampaignDetail.tsx:143–169`). Že plánovač zapisuje v deň OD o 00:05 (D32) sa
Samuel z UI nedozvie vôbec.

Súvisí s tým aj to, že stavy `naplánovaná` a `zapísaná` vyzerajú rovnako zelené
(`StatusBadge.tsx:13,16`) — pritom jedna do shopu ešte nezapísala nič, druhá už
áno a nedá sa vrátiť.

**Dopad: stredný.**

**Riešenie.**
1. V detaile riadok „Zápis: 19.09.2026 00:05 (plánovač)" / „Zápis: vykonaný
   05.08.2026 22:11 (okamžitý)".
2. V zozname stĺpec „Zapíše sa" (pri `eager` po potvrdení „hneď").
3. Farebne odlíšiť „naplánovaná" (neutrál/outline — do shopu nešlo nič) od
   „zapísaná" (zelená).

---

### U17 — Dôvod, prečo je tlačidlo vypnuté, je len v `title` tooltipe

**Problém.** `Button` dáva `disabledReason` výhradne do `title`
(`ui/Button.tsx:44`). Snímka `06`: „Pokračovať na dry-run →" je zosvetlené a
**na obrazovke nie je ani slovo o tom, že chýba dátum DO**. Na tabletoch/touch
sa tooltip nezobrazí vôbec a čítačke obrazovky sa `title` na `disabled` prvku
neoznámi spoľahlivo.

To isté sa opakuje v `ConfirmPanel.tsx:193–199`, `ExtendDialog.tsx:113`,
`AddProductForm.tsx:100–104`.

**Dopad: stredný** (blokované primárne CTA bez viditeľného dôvodu).

**Riešenie.** Dôvod vypísať ako viditeľný text vedľa/pod CTA (`role="status"`),
tooltip nechať ako doplnok. Pri viacerých dôvodoch všetky, nie len prvý —
`NewCampaignWizard.tsx:295` dnes ukáže iba jeden zo troch.

---

### U18 — Mobil: ~330 px chrome a 13 filtrov pred obsahom, tabuľka odrezaná bez indikácie

**Problém.** Snímka `13-mobil-kampane.png`:

- pred nadpisom „Kampane" je: produkčný pruh (2 riadky) + logo + navigácia
  (2 riadky) + 3 stavové badge (2 riadky) + read-only pruh ≈ **330 px**,
- potom **13 filtrových čipov v 4 riadkoch** (`CampaignFilters.tsx:25–39`) a
  tlačidlo „+ Nová kampaň" — obsah začína hlboko pod prvým zobrazením,
- tabuľka ukazuje 4 zo 6 stĺpcov; „Režim" a „Položky" sú mimo obrazovky.
  `.ovl-table-wrap { overflow-x: auto }` (`globals.css:242`) scroll umožní, ale
  **nič nenaznačuje, že tam ďalšie stĺpce sú**,
- „OKNO" je odrezané na `03.08.2` / `19.08.2` — dátum je nečitateľný,
- názvy kampaní sa lámu po slabikách („Vianoce −25 % (naplánované)" na 3 riadky),
- `globals.css` nemá **ani jednu** `max-width` media query (jediná je
  `min-width: 820px` pre dashboard grid, riadok 185).

**Dopad: stredný** — ak je mobil len na kontrolu stavu, je použiteľný s trením;
na zápis nie (viď rozhodnutie R-D).

**Riešenie.**
1. `@media (max-width: 640px)`: filtre zbaliť do `<select>` alebo za tlačidlo
   „Filtre (všetky)"; stavové badge do jedného zhrnutia, ktoré sa rozbalí.
2. Tabuľky kampaní a položiek na úzkych obrazovkách vykresliť ako karty
   (názov + badge + okno + percento + počet položiek).
3. Pri horizontálne scrollovateľnej tabuľke pridať gradient/tieň na pravej hrane.
4. `white-space: nowrap` na dátumové bunky.

---

### U19 — Zaškrtávacie pole „vedome prepisujem" sa objaví práve vtedy, keď je zbytočné

**Problém.** `NewCampaignWizard.tsx:250–266`: keď má vybraný produkt podľa
vlastnej DB bežiacu/naplánovanú zľavu, checkbox **zmizne** a nahradí ho
informačný text — `kind` sa nastaví na `'overwrite'` automaticky
(`NewCampaignWizard.tsx:101`). Checkbox „Vedome prepisujem prípadnú existujúcu
zľavu (D28)" sa zobrazí **iba** vtedy, keď nie je čo prepisovať (snímky `06`,
`07`). Explicitné potvrdenie sa teda pýta presne v prípade, kde nič neznamená.

Skutočné explicitné potvrdenie prepisu je diff v `ConfirmPanel.tsx:129–151`, a to
je správne miesto.

**Dopad: nízky** (mätúce, nie nebezpečné).

**Riešenie.** Checkbox z kroku 1 odstrániť (diff v potvrdení plní úlohu
explicitného prepisu podľa D28) — alebo ho zobraziť len pri konflikte a menovať
produkty, ktorých sa týka.

---

### U20 — Dashboard: statický text zaberá polovicu prvého zobrazenia, primárna akcia chýba

**Problém.** Snímka `03`: hneď pod bannermi je vedľa karty kľúča karta „Čo tento
dashboard vie a nevie" (`Dashboard.tsx:89–97`) — text, ktorý sa **nikdy nemení**
a zaberá ~50 % šírky prvého zobrazenia. Až pod tým sú „Posledné kampane"
a mriežka allowlistu. Chýba: primárne CTA „+ Nová kampaň", prehľad „čo sa
chystá" (U4) a čokoľvek o `fireAt` (U16).

**Dopad: nízky až stredný.**

**Riešenie.** Poradie: (1) zásah vyžadujúce kampane, (2) nepotvrdené výsledky,
(3) **Chystá sa** + „+ Nová kampaň", (4) kľúč (kompaktne — odpočet je aj
v hlavičke), (5) posledné kampane, (6) allowlist. „Čo dashboard vie a nevie"
zbaliť za „?" pri nadpise alebo dať do pätičky (v pätičke už polovica tej vety je).

---

### U21 — Načítavacie a prázdne stavy nemajú akciu

**Problém.**
- Zlyhanie dashboardu = jedna červená veta „Skús obnoviť stránku"
  (`Dashboard.tsx:77–81`) bez tlačidla; loader ju znova nespustí.
- To isté v `CampaignList.tsx:113–116` a `ProductsPanel.tsx:37–39`.
- `Table` prázdny stav je iba `<p class="ovl-muted ovl-small">` (`Table.tsx:32–34`)
  — vizuálne nerozoznateľný od stále sa načítavajúcej tabuľky a bez akcie.
  „Žiadne kampane pre zvolený filter." neponúkne „Zmazať filter".
- „Zatiaľ žiadne kampane. Prvú vytvoríš v sekcii Kampane."
  (`CampaignsMini.tsx:51`) je návod bez odkazu — pritom je v komponente, kde
  odkaz „všetky kampane →" už existuje.
- Skeletony sú tri sivé bloky bez štruktúry (`Dashboard.tsx:67–75`), takže
  po dotiahnutí dát obsah poskakuje.

**Dopad: nízky.**

**Riešenie.** Tlačidlo „Skúsiť znova" na každom chybovom stave (volá ten istý
`load()`); prázdne stavy s CTA („+ Nová kampaň", „Zmazať filter", „Pridať
produkt"); skeleton s rovnakým počtom riadkov ako cieľová tabuľka.

---

## Rýchle výhry

Poradie podľa efekt/čas. Prvé tri sú menej než hodina spolu.

1. **Vypustiť D/I kódy z 20 UI stringov** (U9) — zoznam miest je vyššie.
   Mechanická zmena, okamžite čitateľnejšie hlášky.
2. **Odblokovať prekryv informáciou** (U3) — zmazať `void overlapIds`
   (`preview.ts:139`), preniesť `overlaps` do blokátora a vykresliť s odkazom.
   Dáta už existujú, ide o ~15 riadkov.
3. **Interpretovaný dátum pri pickeroch + dĺžka okna** (U5) —
   `formatDateSk()` už v projekte je; jedna veta zabije najhoršiu triedu omylov.
4. **Opraviť parametre dry-runu pri dopálení** (U1) — `kind: c.kind` a
   `from: max(dateFrom, dnes)`. Dva riadky, sprístupní zablokovanú cestu.
5. **Doplniť `fireAt` do detailu kampane** (U16) — hodnota je už v odpovedi.
6. **Rozpísať počítadlá položiek + veta o `not_found` pod retry tlačidlom** (U6).
7. **Dopočítať cenu pri „rozhodoval si nad inou cenou"** (U7) — `PriceHint`
   s `priceAtWrite`.
8. **`disabledReason` ako viditeľný text** (U17) — zmena v `Button` + volajúcich.
9. **Vypustiť `DISCOUNTED_PRICE_DISCLAIMER_SK` z `item.warnings`**
   (`preview.ts:202`) — odstráni jednu z troch kópií toho istého (U10).
10. **„+ Nová kampaň" na dashboard** (U8) — jeden `<a>`.
11. **Badge zostávajúceho sudo okna v hlavičke** (U12) — `sudoSecondsLeft()`
    už existuje a nikto ho nevolá.
12. **Prepustiť `campaignId` v `/api/allowlist` a spraviť z posledného vlastného
    zápisu odkaz na kampaň** (U13) — jedno pole v serializácii.
13. **Synchronizovať pole domény v onboardingu** (U15) — `useEffect` na prop.
14. **Vlastný blokátor „chýba API kľúč" namiesto `shop_unreachable`** (U2) —
    hláška + odkaz na Nastavenia.

---

## Vyžaduje rozhodnutie používateľa

Miesta, kde existuje viac legitímnych ciest. Bez Samuelovej odpovede sa nemá
implementovať ani jedna.

### R-A — Koľko trenia má mať heslo pri zápise? (U11, U12)

Dnes: sudo okno 15 min (`SUDO_WINDOW_MINUTES`, max 60), formulárové pole na heslo
**a** sudo dialóg = to isté heslo dvakrát; panic button trikrát.

- **A1** Nechať ako je (maximum trenia, ale dvojité zadanie je len omyl v UI).
- **A2** Heslo z formulára server prijme ako sudo re-auth a v tom istom requeste
  obnoví sudo okno → jedno zadanie, rovnaká bezpečnosť.
- **A3** Formulárové polia na heslo zmiznú, `SudoPrompt` je jediné miesto na
  zadanie hesla; okno zdvihnúť na 30–60 min (v rámci `env` stropu).
- **A4** Pridať vedomé „Odomkni na 15 minút" pred dávkou viacerých kampaní, aby
  sa heslo pýtalo raz na začiatku, nie uprostred zápisu.

### R-B — Čo má appka ponúknuť, keď dry-run zablokuje prekryv? (U3)

- **B1** Iba informovať a odkázať na kolidujúcu kampaň (najkonzervatívnejšie).
- **B2** Ponúknuť „Vyradiť kolidujúce produkty z tejto sady" jedným klikom
  a hneď prepočítať dry-run.
- **B3** Ponúknuť „Zrušiť kolidujúcu kampaň" priamo z blokátora (s vlastným
  potvrdením) — rýchle, ale zrušenie sa dá kliknúť v rozčarovaní.
- **B4** Povoliť vedomé prekrytie zaškrtnutím „prekrývam vedome" —
  **koliduje s D28**, viď posledná sekcia.

### R-C — Ako ďaleko zájsť s predvyplňovaním? (U8)

- **C1** Len „Duplikovať kampaň".
- **C2** + pomenované uložené sady produktov („Vianočná päťka").
- **C3** + „posledná použitá sada" jedným klikom (bez pomenovania).
- **C4** Nechať bez skratiek — 5 klikov na sadu je akceptovateľné.

### R-D — Je mobil skutočný pracovný scenár? (U18)

- **D1** Nie — mobil je náhoda, neoptimalizovať (nulová práca).
- **D2** Mobil len na kontrolu: dashboard + stavy kampaní čitateľné, zápisové
  akcie zámerne vypnuté s vysvetlením („zápis rob na počítači").
- **D3** Plná parita vrátane zápisu → karty namiesto tabuliek, väčšie ciele,
  zbalené filtre (najviac práce, najväčšie riziko preklepu na telefóne).

### R-E — Ako nahlas priznávať neistotu o stave shopu? (U10)

- **E1** Nechať dnešnú maximálnu redundanciu (najhonestnejšie, najmenej čitateľné).
- **E2** Jeden disclaimer na obrazovku (pätička) + riadkové varovanie len tam,
  kde sa niečo odlišuje.
- **E3** Trvalá veta v hlavičke/pätičke + badge len pri produktoch, ktoré
  **majú** vlastný zápis → **koliduje s D7**, viď posledná sekcia.

### R-F — Čo má byť v prvom zobrazení dashboardu? (U4, U20)

- **F1** Dnešné poradie.
- **F2** zásah → nepotvrdené → **Chystá sa (fireAt + pripomienky)** → CTA nová
  kampaň → kľúč kompaktne → kampane → allowlist.
- **F3** Rozdeliť na dva bloky: „Dnes" (beží / dnes expiruje / dnes sa zapíše)
  a „Chystá sa" (najbližších 7 dní).

### R-G — Má odobranie produktu z allowlistu vyžadovať potvrdenie? (U14)

- **G1** Nechať okamžité (dnešný stav; allowlist je fail-closed poistka, jeho
  zúženie nie je nebezpečné).
- **G2** Inline potvrdenie „Naozaj odobrať?".
- **G3** Heslo/sudo ako pri doméne (najviac trenia, pravdepodobne prehnané).

### R-H — Ako sa má správať dopálenie zmeškanej kampane, keď sa OD posunie na dnes? (U1)

D25 hovorí, že `from` sa posunie na dnes — okno sa tým **skráti**.

- **H1** Posun bez otázky, len s vetou v audite (dnešná litera D25).
- **H2** Pred dry-runom ukázať dôsledok („pobeží 15 dní namiesto 17") a nechať
  potvrdiť.
- **H3** Ponúknuť aj alternatívu „posunúť celé okno" ako nový prepis
  (nová kampaň s novým OD aj DO).

### R-I — Má sa dať pripraviť kampaň bez platného kľúča? (U2)

- **I-a** Nie — bez kľúča je „+ Nová kampaň" vypnutá s vysvetlením
  (najjednoduchšie, žiadna stratená práca).
- **I-b** Áno až do dry-runu (dry-run číta shop, takže bez kľúča aj tak padne) —
  formulár sa dá vyplniť a uložiť ako **návrh** (`draft` v stavovom stroji už
  existuje), zápis blokovaný.
- **I-c** Áno celý formulár, blokované len finálne tlačidlo (dnešný stav plus
  vypnuté tlačidlo).

### R-J — Kde presne má read-only režim brzdiť? (U2)

- **J1** Len finálne tlačidlo „Zapísať do PRODUKCIE".
- **J2** Vstup do „Novej kampane" (link vypnutý s vysvetlením) + tlačidlá
  v Produktoch.
- **J3** Všetky mutácie vrátane pridania do allowlistu a „Obnoviť z shopu"
  (obe si vyžadujú kľúč, takže by inak zlyhali na 401).

---

## Koliduje s existujúcim rozhodnutím

| Zistenie | Rozhodnutie | Kolízia a čo to znamená |
|---|---|---|
| **U10 / R-E3** — badge „podľa vlastného zápisu" len pri produktoch s vlastným zápisom | **D7**, čiastočne **I11** | D7 znie „Pri **každom** produkte MUSÍ byť badge". Redukcia na produkty s vlastným zápisom **vyžaduje zmenu rozhodnutia D7**. I11 sa dá splniť aj tak (produkt bez zápisu nezobrazuje žiadny stav zľavy, takže niet čo označovať), ale výklad musí potvrdiť Samuel. Variant E2 (jeden disclaimer na obrazovku + riadkové len pri odlišnosti) je s D7 aj I11 zlučiteľný, ak badge na produkte zostane. |
| **U10** — vypustenie disclaimeru z riadkových „Upozornení" | **D4** | D4 žiada zľavnenú cenu „**vždy** s upozornením". Splnené zostáva, pokiaľ disclaimer drží `PriceHint` v tej istej bunke. Odstránenie disclaimeru **z `PriceHint`** (napr. len pätička) by **vyžadovalo zmenu rozhodnutia D4**. |
| **R-B4** — povoliť vedomé prekrytie dvoch budúcich kampaní | **D28** | D28: „prekryv dvoch **budúcich** kampaní na tom istom produkte MUSÍ byť blokovaný pri vytváraní". Akékoľvek „prekrývam vedome" **vyžaduje zmenu rozhodnutia D28**. Varianty B1–B3 sú s D28 plne zlučiteľné (blokátor zostáva, mení sa len jeho čitateľnosť a cesta von). |
| **U8** — presety `od zajtra`, `1 mesiac`, `3 mesiace` | **D12** | D12 vymenúva presety „7/14/30 dní a do konca mesiaca". Pridanie ďalších je rozšírenie nad znenie → **vyžaduje rozšírenie rozhodnutia D12** (nie jeho zrušenie; existujúce presety zostanú). |
| **U19** — odstránenie checkboxu „vedome prepisujem" z kroku 1 | **D28** | Bez kolízie: D28 žiada „explicitné prepísanie s diffom starý → nový **v potvrdení**". Diff v `ConfirmPanel` túto požiadavku plní; checkbox v kroku 1 nie je normovaný nikde. |
| **U11 / R-A3** — zrušenie formulárového poľa na heslo | **D80**, **D79**, **D70** | D80 („zmena domény MUSÍ vyžadovať heslo") a D79 (odomknutie zápisov heslom) sú splnené aj vtedy, keď heslo zoberie `SudoPrompt`. Ak by však stačilo **už otvorené sudo okno bez akéhokoľvek zadania hesla**, D80/D79 sú porušené → variant A3 musí `SudoPrompt` vynútiť vždy, alebo **vyžaduje zmenu rozhodnutia D80** (a D79). Variant A2 je bez kolízie. |
| **U12** — badge sudo/session v hlavičke | **D5** | Bez kolízie. D5 normuje badge TTL kľúča; ďalšie badge nezakazuje. Pozor len na to, aby nový badge neuberal pozornosť odpočtu kľúča (D5 vyžaduje trvalý badge na každej stránke). |
| **U18 / R-D3** — zápis z mobilu | — | Kontrakt mobil nespomína vôbec. Bez kolízie, ale je to nové rozhodnutie (R4/I5 zostávajú v platnosti: appka je dostupná len z `127.0.0.1`, takže „mobil" znamená mobilný prehliadač na tom istom stroji alebo cez lokálnu sieť — čo je v rozpore s I5, ak by sa Caddy vystavil mimo loopback. **Zápis z telefónu preto nesmie viesť k zmene bindu.**) |

### Nie kolízie, ale nesplnené rozhodnutia (dlh oproti kontraktu)

Tieto zistenia nič nekolidujú — kontrakt ich **vyžaduje** a implementácia zaostáva:

- **U2** vs **D10** — „zapisovacie akcie disabled s tooltipom": nie je vypnutá
  ani jedna akcia; `READ_ONLY_TOOLTIP` má nulových konzumentov.
- **U4** vs **D26** a **D8** — banner „vlož kľúč pre kampaň X" 48/24/2 h
  neexistuje; ohrozené naplánované kampane nie sú v agregovanom banneri.
- **U5** vs **D13** — dátumy sa nezobrazujú v `DD.MM.YYYY` (natívny picker
  ukazuje `mm/dd/yyyy`).
- **U15** vs **D20** — na onboarding checklist nič nevedie a nedá sa dokončiť
  (`markOnboardingDone()` bez volajúceho).
- **U1** vs **D33b** (odchýlka 1, bod 3) — manuálne spustenie zmeškanej kampane
  má prejsť kontrolou okna a dry-runom; v UI sa nedokončí.
- **U6** vs **D15**/**D34** — report OK/zlyhané nepokrýva všetky stavy položiek
  a nepovie, ktoré položky opakovanie zámerne vynechá.
- **U13** vs **D18** — filtre auditu existujú, ale audit stopa kampane je
  nedosiahnuteľná (chýbajúci `campaign_id` na zápisových eventoch) a nedá sa
  na ňu odkázať.
