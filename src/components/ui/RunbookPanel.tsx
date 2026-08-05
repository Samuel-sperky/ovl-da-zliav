/**
 * Aura Zľavy — runbook panel (D67, §8).
 *
 * Zobrazuje kroky runbooku (napr. po panic buttone) priamo v UI, aby
 * používateľ nemusel hľadať dokumentáciu v strese.
 */
export interface RunbookPanelProps {
  title: string;
  steps: readonly string[];
  /** Odkaz na plný runbook (docs/21-RUNBOOKY.md), ak existuje. */
  runbookUrl?: string | null;
}

export function RunbookPanel({ title, steps, runbookUrl }: RunbookPanelProps) {
  return (
    <section className="ovl-runbook" aria-label={title}>
      <h3>{title}</h3>
      <ol>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {runbookUrl ? (
        <p className="ovl-small">
          Plný runbook: <a href={runbookUrl}>{runbookUrl}</a>
        </p>
      ) : null}
    </section>
  );
}

export default RunbookPanel;
