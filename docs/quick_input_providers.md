# Quick Input: provider-owned query projections (A06)

Status: queryownership en commandmatching geïmplementeerd; het interactiecontract
staat afzonderlijk in `quick_input_interaction.md`. Symbol-/locationkeuzes zijn
gemigreerd volgens `source_quick_access.md`; matchpresentatie volgt
`quick_input_highlights.md`. File/symbol-fuzzymatching blijft open A06-werk.
De providergrens alleen sluit die niet.

## Productievoorbeelden en live eigenaar

VS Code op `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [`PickerQuickAccessProvider.provide`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/pickerQuickAccess.ts)
  schakelt control-filtering/sortering uit, vraagt `_getPicks` bij querywijziging
  en publiceert de providerresultaten en actieve keuze aan de picker. De UI
  herinterpreteert die resultaten niet als bestandsnamen of commandlabels.
- [`CommandsQuickAccess`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/commandsQuickAccess.ts#L98-L129)
  gebruikt woord-/substringmatching voor commandlabels. Een alfabetische chooser
  is geen reden om bestandsranking of runtime-commandadmission daar te verplaatsen.
- [`GotoSymbolQuickAccess`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L290-L358)
  bewaart de betekenis van symbolen, containers, matches en bronlocaties in de
  provider. De lijst wordt niet de language-service of de source-navigationowner.

Godot op `4cefd60f5a3d733506cb557d6cd26263b3fbd17f` geeft in
[`EditorCommandPalette::_score_path`](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/settings/editor_command_palette.cpp#L51-L111)
voorrang aan aaneengesloten en volledige matches boven losse vervolgletters.
BMSX heeft geen command-MRU of TF-IDF; de commandprovider gebruikt daarom
expliciete matchklassen (exact label/id, substring, woordgrenzen) en behoudt
catalogusvolgorde binnen een klasse. Een exacte `Run: Resume` blijft vóór het
langere, eveneens passende `Run: Hot Resume` staan. Geen command-specifieke
uitzondering of verdwenen fuzzy-resultaat om die ambiguïteit te verbergen.

De woordmatcher neemt VS Code's adjacent/next-word-recurrence over, maar berekent
die iteratief met retained numerieke opslag. De caller vouwt hoofdletters één
keer bij admission/query; commandlabels zijn hier de vaste eigen Engelstalige
catalogus. Accentnormalisatie en input-method-transliteratie uit VS Code worden
niet geclaimd of gebruikt. De testoracle bewaart de bijbehorende ASCII-branches
van de gepinde productiecode, inclusief memoization en separator-equivalentie;
de productiematcher roept die oracle niet aan. Dit vervangt nog niet de aparte
file/symbol-matching. De latere matchpresentatie gebruikt dezelfde recurrence
om ook de gematchte posities te publiceren, niet een tweede zoekpass in de UI.

Bij aanvang van deze provider-slice bezat `QuickPickModel` nog samengestelde
lowercase search keys, tokenmatching en ranking. De providers leverden alleen
display-items. Symbol- en locationkeuzes hadden bovendien een eigen globale
popup-/query-/scrollstate.
De bestaande substringsemantiek is beperkt maar geen corruptiebug; zij mag als
expliciete tekstkeuzepolicy bestaan, niet als verborgen zoekpolicy van alle UI.

## Contract

1. Een `QuickPickProvider<T>` bezit één toegelaten, getypeerde itemcatalogus en
   `getPicks(query)`. De projection levert de gerangschikte itemindices en de
   geselecteerde resultaatindex. De provider publiceert geldige indices; de
   consumer valideert of repareert die niet. Geen async-providerframework,
   extension host of timeout voor de huidige synchrone catalogi.
2. `QuickInputController` bezit de popup-/focus-/subscriptionlifetime en geeft
   bij accept precies `T` terug uit die catalogus, na sluiten. De bestaande
   session-disposables blijven de grens voor source-generaties; niet een extra
   query naar de workspace bij elke letter of scrollbarbeweging.
3. `QuickPickModel` consumeert de queryprojection direct, behoudt selectie en
   viewport en publiceert zijn eigen projectierevisie. Het bevat geen matcher,
   tweede filterpass of sorteervergelijker meer. Pas een werkelijk zichtbare
   keuze krijgt een retained renderrecord, keyed op de admission-index. De
   renderer bezit alleen tekst-/highlightgeometrie. Geen tweede volledige
   catalogus met vooraf aangemaakte UI-records boven op de queryrecords.
4. Een gedeelde tekstkeuzeprovider hergebruikt opgeslagen matchrecords en
   result-storage. Providerfamilies kiezen matching/ranking; de control doet
   geen tweede filterpass. Querydata en UI-textcache hebben verschillende
   verantwoordelijkheden en lifetimes, niet twee zoekcatalogi.
5. Symbolen en reference-/definitionlocaties blijven echte semantic-service-
   resultaten met hun oorspronkelijke resource/range. Geen heaplookup, nieuwe
   symbolen, naam-only dedup of code-tab-facade. De bestaande navigation- en
   reference-sessionowners blijven accept/Next/Back beheren.

## Gates

- Een testprovider bepaalt een niet-alfabetische volgorde en een niet-eerste
  actieve keuze, zonder dat de control die hersorteert, filtert of herindexeert.
- Er is precies één query per inputwijziging, geen query op frames; vervangen,
  sluiten en source-invalidation beëindigen de cataloguslifetime.
- Commands, files, behavior-occurrences en symbol/locationproviders worden op
  hun eigen matching- en broncontract getest. Gedeelde UI is geen bewijs van
  correcte querysemantiek. Geen nieuwe game-specifieke testfixtures.
- Groot onafhankelijk catalogusprofiel plus echte Studio/Source/Undo/palette-
  gates op software, WebGL2 en WebGPU. Geen cold-workspace/zwakke-hardwareclaim
  afleiden uit een kleine controltest.

## Uitvoering en bewijs (2026-09-11)

De vijf bestaande picker-ingangen leveren nu een provider. Commandlabels hebben
hun eigen querypolicy; files en behavior-occurrences kiezen expliciet de
bestaande letterlijke tekstpolicy. `QuickPickModel` bewaart geen search key of
sorteercode en kopieert geen tweede matchlijst. De provider houdt de echte
admission-items en matchrecords; de UI cachet uitsluitend de gepresenteerde rijen.
De bestaande source-generation-disposables blijven intact.

De onafhankelijke providerproef levert bewust een afwijkende volgorde, niet-eerste
selectie en matches zonder zichtbaar querysubstring. De UI neemt die projection
over en accepteert exact het oorspronkelijke item; zij vraagt niet opnieuw op
warme frames. Een afzonderlijke oracleproef vergelijkt de iteratieve woordmatcher
met de gepinde VS Code-branches over separator-/woordcombinaties, inclusief lange
herhaalde separators. Eigen tests bewijzen daarnaast de scheiding van command-
en letterlijke keuzequery's en de prioriteit van volledige commandmatches.

De echte-machine-tegenproef voor `hr` faalt op `82cdf14ed` met de oude IDE-owners,
zonder gebruik van de nieuwe provider-API. De huidige smoke slaagt op software,
WebGL2 en WebGPU; de tiny/software-screenshot is visueel gecontroleerd. De volle
Studio-workflows, inclusief source-edit/Undo, palette-admission tijdens een bezette
runtimequeue en scroll/capture, én de volledige Pietious navigation/graph/Undo-
gate slagen op alle drie renderers. Lua: 1549 tests, 1548 geslaagd, één bestaande
skip. IDE typecheck, strict architecture (0), core parity, indentation en
browserproductbuild slagen; de tests-typecheck behoudt de 51 bestaande meldingen.

Deze oorspronkelijke provideruitvoering claimde geen matchmarkering,
file-fuzzy-ranking of gemigreerde symbol-/reference-/definitionpicker. De
source-controlmigratie volgt in `source_quick_access.md`; matching/highlights
blijven open.

### Gerichte kosten, geen workspace- of hardwarebewijs

`profile_quick_input.ts` en `profile_command_query.ts` zijn apart van browser/
typecheckprocessen gedraaid: drie processen, tien warmups en 25 samples per
mediaan. Admission/query/layout voor 128/1024/8192 tekstkeuzes kost respectievelijk
0,050–0,056 / 0,082–0,083 / 0,704–0,775 ms. Slechts tien rijen worden gepresenteerd
bij deze viewport. Warme updates zitten rond 0,021 microseconde per frame.
Dat is dezelfde orde als `82cdf14ed`, geen geclaimde nieuwe versnelling daartegen.
Een eerdere tussenversie maakte alsnog een tweede volledige UI-rijcatalogus
(8192: 0,865–0,928 ms); die onnodige allocaties en kopiepass zijn bij de modelowner
weggehaald, niet met een resultaatlimiet of timeout afgeschermd.

De commandproef gebruikt alle 62 geregistreerde commands met hun inactieve titels,
zonder runtime-admission of workspacequery. Medianen per `getPicks`, in
microseconden: leeg 0,13–0,17; `h` 8,02–8,20; `hr` 19,04–19,26; `hot res`
51,74–53,11; `Run: Resume` 82,94–83,92; `scenarioLab.cancel` 92,94–93,59;
geen match (`not available`) 83,72–86,13. Providerprojection, matchrecordidentiteit
en result-storage blijven behouden. Dit zijn control-/querymetingen, geen
totale-frame-, GC-, cold-semantic-workspace- of SNES-mini-benchmarks.
