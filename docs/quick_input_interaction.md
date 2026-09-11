# Quick Input: lijstinteractie vóór providerconvergentie (A06)

Status: interactiecontract geïmplementeerd. A06 wordt hiermee niet gesloten:
provider-eigen matching/highlights en migratie van symbol-/locationkeuzes blijven
onderdeel van het eindcontract.

## Gelezen productiecode

VS Code op `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [QuickInputList.filter](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/quickInputList.ts#L1423-L1501)
  houdt lijstbediening apart van matchvelden, highlights en provider-ranking.
- [CommandsQuickAccess](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/commandsQuickAccess.ts#L56-L147)
  matcht commands via woordgrenzen/substring en voegt geen bestandszoeksemantiek
  aan de generieke control toe. De bestaande BMSX-substringfilter is nog geen
  implementatie van die volledige providergrens.
- [AbstractScrollbar](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/scrollbar/abstractScrollbar.ts#L185-L275)
  bezit thumb/track-pointerbediening zonder de tekstinput focus te laten verliezen.
  BMSX heeft reeds `Scrollbar` als range/geometry-owner en `PointerCaptureService`
  als fysieke gesture-owner. Geen DOM-offset-fallbacks of tweede monitor overnemen.
- [Quick Input-keybindings](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/quickInputActions.ts#L101-L124)
  gebruiken Ctrl+Home/End voor lijstgrenzen. Gewone Home/End blijven tekstediting.
- [ListView.render](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/list/listView.ts#L923-L955)
  bereidt uitsluitend het zichtbare bereik voor. BMSX behoudt rijobjecten en
  geclipte teksten per font-/breedtegeneratie: scrollen bereidt alleen nieuwe
  zichtbare rijen voor, filteren invalideert het bereik maar niet ongewijzigde
  rijtekst. De projectie-owner publiceert haar revisie; er komt geen volledige
  catalogusmeting per resize of fontwissel.

## Live grens en gekozen contract

De gedeelde picker heeft al één itemcatalogus, sessielifetime en queryveld. Haar
lijst heeft echter een apart rij-scrollgetal, geen thumb, een maximum van tien zichtbare rijen
en accepteert al op pointer-down. `WorkbenchScrollControl` combineert momenteel
focusbare contentbediening met een niet-focusbare scrollbar-gesture. Een picker
moet juist queryfocus behouden tijdens scrollen.

1. `Scrollbar` blijft de enige scroll/range/geometry-owner. Een gedeelde
   `ScrollbarPointerControl` bezit uitsluitend de fysieke axis-gesture. De
   bestaande focusbare `WorkbenchScrollControl` en de picker gebruiken dezelfde
   leaf-control; geen picker-specifieke dragformule of focusuitzondering.
2. `QuickPickModel` consumeert de bestaande `WorkbenchScrollViewport` met pixels
   als contentcoördinaten. Er komt geen gesynchroniseerde tweede `scroll`-waarde
   of oude-layoutadapter. De chooser bezit vaste rijgeometrie, zichtbare indices
   en selection-reveal; andere workbench-lijsten behouden hun eigen bestaande
   representatie. De basis-Scrollbar blijft ook rij-/kolomcoördinaten ondersteunen.
3. De popup past in de echte viewport, met gereserveerde scrollbarbreedte en
   geclipte zichtbare rijen. Geen resultaatlimiet, DOM-scrolllaag, volledige
   tekstherberekening per frame of nieuwe lijstallocatie tijdens muisbewegingen.
4. Queryfocus blijft tijdens thumb/track-bediening behouden. Een rijpress selecteert
   en capturet die concrete admitted row. Alleen release op dezelfde rij accepteert;
   buitenrelease, inputverlies, querywijziging, resize en sessie-einde annuleren.
   Een gecanceld gebaar mag geen nieuwe of inmiddels hersorteerde rij uitvoeren.
5. Keyboard/page/wheel/reveal gebruiken dezelfde viewport. Ctrl+Home/End kiest
   eerste/laatste resultaat; Home/End blijven beschikbaar voor het queryveld.
6. Matching en catalogusbetekenis veranderen in deze interactieslice niet. Geen
   tijdelijke algemene fuzzy-scorer die commands, bestanden en symbolen plat slaat.

## Vereist bewijs

Onafhankelijke grote catalogus op tiny/msx en kleine viewport; bereikbaarheid van
alle rijen, fractional-scroll-hit/clipping, queryfocus tijdens thumbdrag, capture-
cancellation op gewijzigde projectie/geometrie, release-activatie en ongewijzigde
tekstediting. De oude press-time-accept/ontbrekende scrollroute moet onafhankelijk
falen. Volledige bestaande Studio- en source/Undo-gates blijven vereist naast
controltests en metingen van warme frames. A06 blijft open tot de provider- en
symbolkeuzecontracten ook werkelijk zijn geïmplementeerd.

## Capture-admission van exclusieve surfaces

De bestaande router blokkeert alle capture zolang Quick Input zichtbaar is.
Dat voorkomt oude canvasdrags, maar blokkeert ook een eigen picker-thumb. De
contextmenu-control kan reeds zelf capturen; een nieuwe bool-uitzondering per
popup is geen schaalbaar contract. De capture-owner krijgt daarom een opaque
surface-scope naast zijn target en knop. De router selecteert de scope volgens
dezelfde voorrang als zijn hit-route: Quick Input, contextmenu, workbench. Een
blocking modal/menubar zonder capture-control weigert admission. Een andere
scope annuleert de oude gesture; popup-open annuleert onmiddellijk en popup-hide
beëindigt zijn eigen controls. Focus en hover blijven afzonderlijke owners.

Dit is beperkt tot de twee bestaande interactieve popups, geen nieuwe window-
manager of hypothetische modal-stack. Qt Quick's
[`QQuickOverlayPrivate`](https://github.com/qt/qtdeclarative/blob/0890fc6e9b1fd1445267028dd4c9d3b2364bdb60/src/quicktemplates/qquickoverlay.cpp#L212-L254)
onderscheidt eveneens popup-owned grabs van gewone child-targets en respecteert
stacking order. Overgenomen wordt die eigenaarsscheiding, niet Qt's close-policy,
zichtbaarheidsfallbacks of pointer-naar-item-model. Test expliciet dat een popup
zijn eigen drag behoudt maar nooit een achtergrondgrab doorlaat.

## Bewijs van deze interactieslice (2026-09-11)

- Zes onafhankelijke controltests dekken release-admission, popup-scope,
  query/geometrie/session-cancellation, Ctrl+Home/End versus gewone caretkeys,
  fractional-scroll-hitmapping en lazy tekstvoorbereiding op tiny/msx.
- De echte Studio-proef opent File Search vanuit een Scene-property en bedient
  de picker via fysieke input. Dezelfde eerste press-time-tegenproef faalt op
  `f853f9681`, vóór gebruik van de nieuwe viewport-API. Huidige volledige
  Studio-workflows en Pietious source/graph/Undo-navigation slagen allebei op
  software, WebGL2 en WebGPU. Een aparte echte-machine-smoke toont de laatste
  catalogusrij na Ctrl+End; tiny/software-screenshot visueel gecontroleerd.
- Volledige Lua-suite: 1545 tests, 1544 geslaagd, één bestaande skip. IDE typecheck,
  architecture-boundaries strict (0), core parity, indentation en browserproduct-
  build slagen. Tests typecheck houdt dezelfde 51 bestaande diagnostieken.

`tests/conformance/runtime_replay/profile_quick_input.ts` meet admission/filter/
layout plus warme `update()`-frames, niet de renderer, hele host of GC. Vóór lazy
voorbereiding werd de hele catalogus gemeten; daarna uitsluitend tien zichtbare
rijen bij deze viewport. Tien warmups en 25 samples per mediaan; één eerder
proces vóór, drie afzonderlijke rustige processen ná:

| Catalogus | Open vóór (ms) | Open ná (ms, bereik medianen) | Voorbereide rijen vóór → ná |
| --- | ---: | ---: | ---: |
| 128 | 0,098 | 0,047–0,052 | 128 → 10 |
| 1024 | 0,484 | 0,082–0,087 | 1024 → 10 |
| 8192 | 4,025 | 0,705–0,756 | 8192 → 10 |

Warme updates kosten in deze microproef ongeveer 0,021 microseconde per frame
in plaats van 0,012: de zichtbare-rangecheck voegt werk toe, maar geen catalogus-
scan, labelmeting of rijallocatie. Dit is geen paired hardwarebenchmark of
bewijs over zwakke apparaten. Provider-matching en symbol-/locationconvergentie
blijven open; deze meting verklaart die rest niet afgerond.
