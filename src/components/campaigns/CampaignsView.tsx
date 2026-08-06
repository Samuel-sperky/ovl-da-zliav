'use client';

/**
 * Aura Zľavy — obsah tabu Kampane (KISS, plán 33 §3, §5 C3).
 *
 * Page-head predlohy (eyebrow gold, titul, `+ Nová kampaň`) + zoznam
 * s toolbar štýlom + drawer novej kampane. Drawer sa otvára tlačidlom aj
 * z URL: `/kampane?nova=1` (kam presmerúva stará stránka /kampane/nova,
 * a teda aj tlačidlo na Dashboarde) — voliteľne s predvyplnením:
 *   `?nova=1&produkty=1,2&percent=15&od=YYYY-MM-DD&do=YYYY-MM-DD`
 *   `?nova=1&podla=<id>` — duplikovanie kampane (predvyplní sa z jej detailu).
 * Predvyplnenie je len pohodlie — dvojkrokový tok s dry-run potvrdením (I3)
 * platí v draweri bez výnimky a výber sa vždy pretína s allowlistom.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { CampaignDetailResponse } from '@/components/campaigns/api';
import { getJson } from '@/components/campaigns/api';
import CampaignList from '@/components/campaigns/CampaignList';
import NewCampaignDrawer, {
  type NewCampaignPrefill,
} from '@/components/campaigns/NewCampaignDrawer';
import Button from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';

function parsePrefillFromQuery(params: URLSearchParams): NewCampaignPrefill | null {
  const prefill: NewCampaignPrefill = {};
  const produkty = params.get('produkty');
  if (produkty) {
    const ids = produkty
      .split(',')
      .map((raw) => Number(raw.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length > 0) prefill.productIds = [...new Set(ids)];
  }
  const percent = params.get('percent');
  if (percent && /^\d{1,2}$/.test(percent)) prefill.percent = Number(percent);
  const od = params.get('od');
  const doParam = params.get('do');
  if (od && doParam && /^\d{4}-\d{2}-\d{2}$/.test(od) && /^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    prefill.from = od;
    prefill.to = doParam;
  }
  return Object.keys(prefill).length > 0 ? prefill : null;
}

export function CampaignsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefill, setPrefill] = useState<NewCampaignPrefill | null>(null);
  // Spotrebovaná query sa pamätá PODĽA HODNOTY — druhé `?nova=1` (aj s inými
  // parametrami) v tom istom mounte sa spracuje tiež, nie len prvé.
  const [consumedQuery, setConsumedQuery] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  // Zmena kľúča vynúti refetch zoznamu kampaní (po vytvorení kampane).
  const [listRefreshKey, setListRefreshKey] = useState(0);

  // URL → drawer (presmerovanie z /kampane/nova, akcie AI agenta,
  // duplikovanie). Query sa spotrebuje raz a z URL sa uprace.
  useEffect(() => {
    if (searchParams == null) return;
    if (searchParams.get('nova') !== '1') {
      // URL sa upratala — ďalšie `?nova=1` sa smie spotrebovať znova.
      if (consumedQuery !== null) setConsumedQuery(null);
      return;
    }
    const queryKey = searchParams.toString();
    if (consumedQuery === queryKey) return;
    setConsumedQuery(queryKey);

    const podla = searchParams.get('podla');
    const fromQuery = parsePrefillFromQuery(searchParams);

    if (podla && /^\d+$/.test(podla)) {
      void getJson<CampaignDetailResponse>(`/api/campaigns/${podla}`).then((res) => {
        if (res.ok) {
          setPrefill({
            productIds: [...new Set(res.data.items.map((it) => it.productId))],
            percent: res.data.campaign.percent,
          });
          setPrefillNotice(null);
        } else {
          // Duplikovanie zlyhalo — drawer sa otvorí prázdny S vysvetlením.
          setPrefill(null);
          setPrefillNotice(
            'Kampaň na duplikovanie sa nepodarilo načítať — formulár začína prázdny.',
          );
        }
        setDrawerOpen(true);
      });
    } else {
      setPrefill(fromQuery);
      setPrefillNotice(null);
      setDrawerOpen(true);
    }
    router.replace('/kampane');
  }, [consumedQuery, searchParams, router]);

  function openDrawer() {
    setPrefill(null);
    setPrefillNotice(null);
    setDrawerOpen(true);
  }

  return (
    <div className="ovl-w-wide">
      <div className="ovl-page-head ovl-view-in">
        <div>
          <Eyebrow>Riadenie zliav</Eyebrow>
          <h1>Kampane</h1>
          <p className="ovl-page-desc">
            Naplánované a zapísané zľavové kampane — stav vychádza z vlastných zápisov appky.
          </p>
        </div>
        <div className="ovl-page-actions">
          <Button variant="primary" onClick={openDrawer} data-testid="new-campaign-link">
            + Nová kampaň
          </Button>
        </div>
      </div>

      <CampaignList onNewCampaign={openDrawer} refreshKey={listRefreshKey} />

      <NewCampaignDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        prefill={prefill}
        notice={prefillNotice}
        onCreated={() => setListRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

export default CampaignsView;
