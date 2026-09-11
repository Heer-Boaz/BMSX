# Scenario-resultaatinspectie (A05)

Status: geïmplementeerd en gevalideerd op 2026-09-11. Het ontwerp is vóór de
productiepatch aan de onderstaande owners getoetst; de detach-correctie volgde
uit de echte browserproef.

## Productiereferentie en toepassing

Gelezen in VS Code op `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [`MessageSubject`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsSubject.ts#L28-L65)
  bewaart resultaat-/berichtidentiteit en de echte boodschap; een reveal-locatie
  is iets anders dan de tekstinhoud.
- [`TestResultsViewContent.reveal`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts#L345-L368)
  toont ook een bericht zonder bronlocatie. De view bezit haar huidige subject
  en de levensduur van de presentatie.
- [`PlainTextMessagePeek`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsOutput.ts#L324-L375)
  leest volledige berichttekst via een read-only tekstpresentatie, niet via
  de korte tree-label of een gesimuleerde bronregel.

De relevante scheiding wordt overgenomen, niet VS Code's URI-protocol,
servicecontainer, editorwidget of bronlocatie-fallback. BMSX heeft al een
volledig leesbare property-inspector met gedeelde scroll-, focus-, action-bar-
en hover-controls. Een log/failure is een inspecteerbaar resultaatrecord: de
inspector kan zijn volledige tekst en context tonen. Geen fake Lua-resource,
tweede bronmodel of nieuwe readonly code-editorwidget voor dit ene doel.

## Live probleem bij aanvang en eigenaar

`ScenarioResultService` bewaart de volledige `log.text` en `failure.message`,
met run/result-identiteit en begrensde opslag. De UI kapt alleen haar rijlabels
af. Activatie van die rijen opent nu een bronbestand in plaats van de volledige
tekst te tonen. Bovendien geeft `appendLog` ieder bericht het begin van het
testbestand als vermeende berichtlocatie. Ook host-failures zonder bron krijgen
die verzonnen locatie. Dat is een producerfout, geen reden voor een UI-fallback.

## Contract

1. **Boodschap:** gebruik het bestaande opgeslagen log/failure-record en zijn
   resultaatidentiteit. Geen nieuwe globale message-id-index of parallelle log.
2. **Bron:** een echte fault-locatie blijft beschikbaar; ontbreken van een
   berichtlocatie blijft ontbreken. Het testbestand is testcontext, niet de
   regel waar een host-log of mislukte verwachting ontstond. Geen guest-stack-
   inspectie of extra cartlib-instrumentatie om die leemte te verbergen.
3. **Bediening:** keyboard/pad/dubbelklik op een log/failure inspecteert tekst;
   een expliciete gedeelde Details-actie doet hetzelfde. Source in de inspector
   is alleen voor de echte berichtlocatie beschikbaar. Test-/run-expansie blijft
   de gewone lijstbediening. UI-navigatie en inspector-lifecycle horen bij de
   pane, uitvoering/resultaatproductie bij de bestaande run/resultaatowners.
4. **Presentatie:** volledige originele tekst, inclusief lege regels, lange
   woorden en expected/actual-staart, is bereikbaar met bestaande scrollbediening
   op tiny-font en 384×288. Geen per-frame tekstsplitsing of herformattering.
5. **Lifetime:** resultaatselectie, Source/Back en inspectie volgen bestaande
   record-identiteit, niet een hergebruikte rij-ordinal. Detach, andere selectie
   en werkelijke evictie sluiten de inspectie. Een nieuwe ongerelateerde log mag
   een nog geldig geopend bericht niet vervangen of zijn scrollpositie resetten.
6. **ActionEffect-bronkeuze:** meerdere herkende bronmatches krijgen de bestaande
   Quick Pick-owner, met onderscheidbare bronlabels en normale Source-navigatie.
   Geen willekeurige eerste match; dit is geen bewijs dat de herkenning exhaustief
   is. De B04-origin-/calleegrens blijft een afzonderlijke open requirement.

### Workbench detach (gevonden door de live gate)

`CartEditor.deactivate` gaf alleen focus/capture vrij; het actieve pane bleef
aan zijn input gekoppeld. Daarmee bleef ook een tijdelijke inspectiesessie
bestaan terwijl de workbench niet meer zichtbaar was. De bestaande
`EditorPanes.clearEditor` is de detach-owner: zij beëindigt control-interactie
en roept pane-eigen `clearInput` aan zonder de tab/input of het document te
verwijderen. `CodeEditorPane.clearInput` bewaart zelf de codeview. Activatie
koppelt de behouden tab via de bestaande `setActiveTab/openEditor`-route terug.

Neem deze route op in workbench-deactivatie, in plaats van per bijdrage een
`onDidChangeActive`-cleanup te installeren of codeview-state in de host te
dupliceren. Dit volgt VS Code's
[`doHideActiveEditorPane`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/browser/parts/editor/editorPanes.ts#L487-L512):
pane detach is onderscheiden van de levensduur van de editor-input. Geen
`safeRun`, DOM-wrapper of nieuw zichtbaarheidssysteem overnemen.

## Gates

- Onafhankelijke lange/multiline log en failure; bron wel/afwezig; volledige
  tekst inspecteerbaar, geen verzonnen bron en geen document-dirty/Undo-effect.
- Retentie-overflow en nieuwe log terwijl inspectie open staat; correcte
  selectie-/message-lifetime, geen opvolger op hetzelfde lijstindexnummer.
- Twee gelijknamige ActionEffect-definities, expliciete keuze en bronpositie;
  wijzigingen/detach tijdens de keuze mogen geen oude ranges toepassen.
- Werkelijke Studio-flow via gedeelde commands, focus, scroll, Source/Back en
  font/renderer-gates, naast typechecks/unittests. Meet retained open-inspector-
  kosten; verwar een tekstlayout-microbenchmark niet met volledige hostlatency.

## Bewijs en afbakening

- Onafhankelijke resultaatteksten en twee gelijknamige effectregistraties in
  `scenario_lab_view.test.ts` en `studio_scenario_output.ts`. De browserfixture
  gebruikt een bestaande bron/testresource als transport/context, niet de actuele
  game-definities als verwachte uitkomst.
- De oorspronkelijke owners van `a9683fb23` falen in dezelfde live browsergate
  bij berichtactivatie: zij openen het testbestand. Dit is geen ontbrekende-API-
  of typecheck-tegenproef. Een latere live tegenproef vond dat workbench-hide het
  pane niet detachte; de bestaande pane-lifecycle is daarop aangesloten.
- Keyboard en gedeelde Details/Source/Back-acties; volledige expected/actual-
  staart bereikbaar op tiny en msx; geen bronwijziging of extra Undo-stap.
  Nieuwe logs behouden het geopende bericht en de scroll. Evictie laat de
  selectie leeg, ook bij een volgende log. Een nieuwe run wordt expliciet op
  zijn eigen identiteit geselecteerd. Bronkeuze voor twee gelijke effect-id's
  opent de gekozen occurrence; wijziging van het bronmodel en workbench-detach
  sluiten de keuze. Geen handmatige reparatie van focus- of viewstate in de gate.
- Volledige Studio-workflow en Pietious-navigatie: software/WebGL2/WebGPU slagen,
  inclusief bestaande Save/Hot Resume-/reboot-, bron- en pointergates. De aparte
  echte drie-renderer-inspectieproef levert ook screenshots; de softwarecapture
  is visueel gecontroleerd. Dat bewijst geen fysieke SNES Mini-UX.
- Lua: **1538 geslaagd, 1 bestaande skip, 0 fouten**. IDE-typecheck,
  toolchain/product-build, architecture strict (0 issues), core-parity,
  indentation en `git diff --check` slagen. Tests-typecheck houdt dezelfde
  **51 bestaande fouten**; alleen regelnummers in het uitgebreide testbestand
  verschillen.

`profile_scenario_output.ts` meet op een rustige host drie afzonderlijke
processen, ieder 10 warmups en 25 metingen. Openen omvat de echte gedeelde
inspector/focus-lifecycle en tekstlayout; stilstaande updates worden in batches
van 100.000 uitgevoerd. Waarden zijn procesmedianen:

| Regels / tekstbytes | Openen (ms, bereik) | Warm update + layout (µs, bereik) |
| --- | --- | --- |
| 64 / 1452 | 0,026–0,058 | 0,0116–0,0117 |
| 1024 / 25430 | 0,417–0,427 | 0,0291–0,0433 |
| 4096 / 108374 | 1,519–1,607 | 0,0419–0,0452 |

De proef controleert behouden rij-identiteit en **geen extra tekstmetingen**
in warme frames. Dit zijn absolute controlmetingen, geen before/after-speedup,
volledige-host-GC-meting of representatieve SNES Mini-benchmark. Bewijslogs en
screenshots: `/tmp/bmsx-scenario-output/`.

Capture-activatie opent nog steeds de expliciete testcontext, niet een verzonnen
capture-statement of een nieuwe screenshotviewer. Berichtlocaties zijn opgenomen
diagnostische locaties; dit werk implementeert geen historische bronrevisie-editor.
De bronkeuzepopup maakt bestaande herkende matches bruikbaar en claimt geen
exhaustieve callee/origin-analyse. B03/B04 en ActionEffect-propertyauthoring blijven
hun afzonderlijke open contracten.
