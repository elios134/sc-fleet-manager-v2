// « Premiers pas » de l'accueil : 5 étapes cochées depuis l'état réel des données (logique pure).

export type FirstStepKey = "account" | "wiki" | "uex" | "starmap" | "gamelog";
export type FirstStepsInput = {
  hasAccount: boolean;
  wikiSynced: boolean;
  uexSynced: boolean;
  starmapReady: boolean;
  gamelogFound: boolean;
};
export type FirstSteps = {
  steps: { key: FirstStepKey; done: boolean }[];
  doneCount: number;
  /** Première étape non faite (celle à mettre en avant) ; null quand tout est fait. */
  next: FirstStepKey | null;
  allDone: boolean;
};

export function firstSteps(i: FirstStepsInput): FirstSteps {
  const steps: { key: FirstStepKey; done: boolean }[] = [
    { key: "account", done: i.hasAccount },
    { key: "wiki", done: i.wikiSynced },
    { key: "uex", done: i.uexSynced },
    { key: "starmap", done: i.starmapReady },
    { key: "gamelog", done: i.gamelogFound },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, next: steps.find((s) => !s.done)?.key ?? null, allDone: doneCount === steps.length };
}
