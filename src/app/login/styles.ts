/**
 * Aura Zľavy — geometria prihlasovacej obrazovky (V12; predloha
 * `design/v3/prihlasenie.html`).
 *
 * Predloha má tieto rozmery v lokálnom `<style>` bloku stránky. Držíme sa toho
 * aj tu, a to z konkrétneho dôvodu: `globals.css` vlastní iný agent a výhradné
 * vlastníctvo súborov je jediná vec, ktorá dovoľuje písať obrazovky paralelne.
 *
 * Karta je úzka a centrovaná, `min-height` počíta so spoločnou hlavičkou nad
 * sebou — tú vlastní shell appky a táto stránka ju neskrýva.
 *
 * Vlastník: V12.
 */

export const LOGIN_CSS = `
.login{min-height:calc(100vh - 160px);display:flex;align-items:center;
  justify-content:center;padding:24px 4px}
.login .sec{width:100%;max-width:360px;padding:22px 22px 20px}
.login .mark{font-size:20px;font-weight:660;letter-spacing:-.02em;color:var(--ink)}
.login .mark b{color:var(--deep)}
:root[data-theme="dark"] .login .mark b{color:var(--teal)}
/* POZOR: tlačidlá sa nesmú označiť triedou btn z návrhového systému — je
   definovaná neskôr než trieda primárneho tlačidla a prebila by mu farbu na
   bielu. Cielime preto priamo na triedu, ktorú dáva komponent. */
.login .ovl-btn{width:100%;justify-content:center;margin-top:6px;
  font-size:15px;padding:11px 20px;align-self:auto}
.login .foot{display:flex;align-items:center;justify-content:space-between;
  gap:10px;margin-top:14px;flex-wrap:wrap}
.login pre.cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11.5px;line-height:1.5;background:var(--paper3);border-radius:6px;
  padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px}
.login .wide{max-width:520px}
.login .row-2{display:flex;gap:8px;flex-wrap:wrap}
.login .row-2 .ovl-btn{flex:1;margin-top:0;font-size:13px;padding:7px 14px}
@media (max-width:760px){
  .login{min-height:auto;padding:8px 0 24px}
}
`;

export default LOGIN_CSS;
