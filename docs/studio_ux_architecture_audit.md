# Studio: UX- en architectuuraudit

Datum: 2026-09-10. Onderzochte checkout: `af51fc9cd` op `master`.
Dit is een audit, geen nieuwe implementatieslice of goedkeuring van het product.
De bevindingen hieronder blijven aan die checkout gekoppeld; de afzonderlijke
correcties staan in **Opvolging** onderaan, zonder de oorspronkelijke tegenproeven
achteraf weg te schrijven.

## Oordeel

**Niet alles voldoet.** Vooral de gedeelde workbench-interactie is minder compleet
dan de bronbewerkings- en runtime-eigenaren. Er zijn echte gebruikersflows gebouwd
om nog code-editor-specifieke infrastructuur heen. Meer featureknoppen toevoegen
zou dat probleem vergroten.

Dat betekent niet dat alles moet worden weggegooid. De canonieke Lua-modellen,
bronbehoudende edits, graph-layoutlifetime en scheiding tussen machine, host en
Studio zijn bruikbare fundamenten. De onderstaande fouten rechtvaardigen geen
tweede scene-database, runtime-RPC, compatibility-reader of extra machine.

## Scope en bewijsniveau

De inventaris omvat de 123 commits na
`05fad993affb8e022c17bd0a79141795c5831e83`, met nadruk op de huidige Studio en
haar gedeelde owners. Teruggedraaide implementaties tellen niet als huidige code.
Dit is een doorsnede van de eigenaren en gebruikersketens, **geen regel-voor-regel
certificering van alle wijzigingen**.

| Gebied | Wat opnieuw bekeken/getoetst is | Oordeel/grens |
| --- | --- | --- |
| Commands, menu's, action bars, focus | Registratie, enablement, pointer, keyboard, paneactivatie; echte Studio-tegenproef | Onvolledig controlcontract: A01 |
| Bronlinks en navigation history | Exacte sourcekeuze, dirty/version, Back vanuit een visual editor | Bronopening zelf verandert geen tekst in de proef; terugroute ontbreekt: A03 |
| Editor inputs, tabs en herstel | Inputidentiteit, modeldeling, autosave/restore-payload | Goede modeldeling; viewidentiteit en sessieherstel onvolledig: A04/A07 |
| BT/FSM-diagrammen | Projectie, gedeelde viewport, pan/capture/drop, async layout, source-editadmission | Fundament behouden; geen volledige algemene behavior-authoringomgeving |
| ActionEffects | Properties-projectie, bronkeuze, trace-erasure en echte cartlib-CPU-tests | Geen aparte runtimegedragsdatabase; normale trace-statements worden verwijderd |
| Scene Editor | Scene-library, bronedits, tree, properties, layout met ander paneel open | Broninspectie/-bewerking bruikbaar; viewportcontract ontbreekt: A02 |
| Scenario Lab | Run/cancel/media-lifecycle, projectie, resultaattekst en bronkeuze | Uitvoering en presentatie gescheiden; resultaatinspectie onvolledig: A05 |
| Quick Pick / Command Palette / symbol search | Provider/session, filter, presentatie, focusherstel | Gedeelde picker bestaat, maar zoek-/lijstcontracten zijn niet af: A06 |
| Save / Hot Resume / pauze | Working-copy-snapshots, save-completion, runtime-queue, expliciete hostpauze | Owners beoordeeld; niet opnieuw de volledige live mutatiematrix uitgevoerd |
| Rewind TS/C++ / hosttransport | Sparse checkpoints, ICU-journal, capture/restore, playback/takeover, capaciteit | Architectuurrichting passend; nieuwe volledige replay- en hardwaremeting ontbreekt: A08 |
| Cartridge-expansie / BIOS / GX | Socket/card-grens, media-installatie, concrete componenten, TS/C++-contracten | Geen actuele Studio-board-id in de machine; clocked expansion expliciet geparkeerd |
| Validatie | Gerichte tests, productievoorbeelden, tegenproeven en mechanische audits | Groene tests blijken geen volledige UX-acceptatie |

De nieuwe Studio-tegenproef gebruikt Chromium, de echte Studio-compositie,
software-rendering, hostframes en de normale IDE-inputroute. Nemesis is uitsluitend
de boot-/workspace-drager; de twee FSM's en BT voor de tegenproeven zijn onafhankelijk
toegevoegde brondefinities. Geen hardgecodeerde spelregelnummers of actorposities
bepalen de verwachte uitkomsten. De bron werd niet opgeslagen of geïnstalleerd.
De Problems-resize is via de bestaande panel-owner ingesteld; niet via een
handmatige overschrijving van Scene-layoutbounds.

## Bevindingen

### A01 — P1: de action bar is nog geen volledig bedienbaar control

**Bewijs:** `ide/workbench/ui/action_bar.ts:10-49` bezit items, hover en rechthoeken,
maar geen focus-/press-/release-lifecycle. Features voeren de command zelf uit op
`justPressed`, onder andere
`ide/workbench/contrib/behavior_lens/editor_pane.ts:160-163` en
`ide/workbench/contrib/scene_editor/editor_pane.ts:115-120`.

De Studio-proef bevestigt:

- `Source` heeft de code-editor al geopend terwijl de primaire muisknop nog vastzit.
- `Remove` heeft de Lua-bron dan al gewijzigd. Buiten de knop loslaten annuleert
  die bewerking niet.
- Tab vanuit de BT-canvas geeft geen focus aan de zichtbare actieknoppen.

**Ontbrekende eigenaar:** een gedeeld action-control met focus, activation en
cancellation. Nu is alleen de presentatie gedeeld; de bijdragen implementeren
het ontbrekende gedrag. Palette/shortcuts maken de commands op alternatieve
manieren bereikbaar, maar maken de zichtbare knoppen niet keyboard-bedienbaar.

VS Code scheidt pressfeedback van commanduitvoering op click en bezit
toetsenbordtraversal/activation in de action bar. Godot heeft een expliciete
button-press/release-state machine met onderscheid tussen action modes.
Dat is geen verbod op selectie of dragstart bij indrukken; het gaat hier om het
committen van gewone, soms destructieve knoppen.
[VS Code action items](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/actionbar/actionViewItems.ts#L130-L159),
[action-bar keyboard](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/actionbar/actionbar.ts#L156-L211),
[Godot BaseButton](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/base_button.cpp#L223-L275).

**Correctie/gate:** voltooi dit controlcontract eenmaal, inclusief verlies van
capture/focus, disable tijdens press en release buiten het target. Koppel het aan
de bestaande focusowner. Geen losse button-fix per bijdrage. Test ook keyboard
zonder palette en behoud focus van de commandcontext wanneer een toolbar die
command activeert.

### A02 — P1: Scene-properties houden geen rekening met beschikbare hoogte

**Bewijs:** `ide/workbench/contrib/scene_editor/render.ts:18-43,78-91` positioneert
properties op vaste rijen en de toelichting op rij 12/13. De details hebben geen
eigen scrollviewport. Het Problems-paneel mag de beschikbare editorhoogte
verkleinen via `ide/workbench/contrib/problems/panel/layout.ts:187-198`.

In de gerasterde Studio-proef, op **384×288 met tiny-font**, wordt het editorvlak
`top=21, bottom=98` na vergroten van Problems. Y loopt van 91 tot 101 en Z van
111 tot 121. Y wordt afgesneden; Z en de toelichting zijn niet zichtbaar. De
overgebleven Scene-inspector biedt geen scrollroute om ze alsnog te bereiken.
De normale kleine Problems-weergave past wél; dit is geen claim dat de standaard
Scene-layout altijd buiten beeld valt.

**Ontbrekende eigenaar:** inhoudsmaat, viewport, clipping, scrollrange en
focus-reveal van een propertypaneel. Een vaste verdeling en handgekozen rijposities
zijn geen vervanging daarvan. Godots `ScrollContainer` koppelt juist child-content,
scrollbars, clipping en focus-zichtbaarheid.
[Godot ScrollContainer](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/scroll_container.cpp).

**Correctie/gate:** een werkelijk scrollbaar propertyvlak dat de beschikbare
paneelruimte consumeert; bereikbaarheid toetsen bij Problems-resize, meerdere
tabrijen en beide IDE-fonts. Niet de huidige rijnummers een beetje opschuiven.
De huidige action bars passen overigens in de afzonderlijke 256/384-pixelproef;
negatieve knopbounds zijn hier niet gereproduceerd.

### A03 — P1: Bron → Terug verliest de visual-editorcontext

**Bewijs:** `ide/navigation/navigation_history.ts:10-15,83-100` kan uitsluitend
`domain/path/row/column` opslaan. `createNavigationEntry()` retourneert `null`
voor ieder niet-code-input. `ide/workbench/ui/tabs.ts:67-87` gebruikt deze owner
ook voor bronopening vanuit de nieuwe editors.

Gereproduceerd: FSM selecteren → Source → Alt+Left blijft in een code-editor;
het brengt de gebruiker niet terug naar de gekozen FSM en haar viewport.
De bronopening zelf liet de modelversie onveranderd.

**Ontbrekende eigenaar:** editor-input plus diens selectie/viewstate als
navigatiebestemming. Een bewaarde codepositie is niet de identiteit van een
graphselectie. VS Code's history bewaart editoridentiteit en een
`IEditorPaneSelection`, niet uitsluitend tekstregels.
[VS Code history](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/services/history/browser/historyService.ts#L1274-L1308).

**Correctie/gate:** maak de navigation-owner bruikbaar voor concrete editorinputs,
met contribution-owned selection bookmarks. Toets diagram → bron → definitie
→ Back → Back → Forward, ook na bronedits. Geen speciale terugknop met een
Behavior-Lens-only geschiedenis naast de bestaande owner.

### A04 — P2: behavior-keuze en tab-identiteit hebben verschillende granulariteit

**Bewijs:** `ide/workbench/contrib/behavior_lens/controller.ts:65-91` kiest een
registratie, maar zoekt het input onder `behavior:<resourceIdentity>`.
`editor_input.ts:22-28` gebruikt dezelfde bestandssleutel en de constante titel
`BEHAVIOR LENS`. Scene-tabs hebben eveneens een constante functietitel.

De onafhankelijke FSM-proef opent `audit.one` en daarna `audit.two` uit hetzelfde
bestand: exact hetzelfde inputobject, evenveel tabs (3), maar de eerste view wijst
nu naar de tweede definitie. De index herkent beide correct; dit is **geen**
indexer- of parserfout. Verschillende bestanden leveren bovendien gelijknamige
Behavior Lens-tabs op.

Dit verhindert naast elkaar behouden/vergelijken van twee behaviorcontexten uit
één bestand. Er is geen expliciet preview/pin-contract dat de vervanging uitlegt.
Ook de bestaande browsertest schrijft hergebruik van de lens voor; die bevestigt
daarmee een ontwerpkeuze, niet dat deze UX voldoende is.

**Correctie/gate:** onderscheid working-copy-identiteit van editor/viewidentiteit.
Behoud één Lua-model; definieer bewust de preview/open/pin-semantiek en herkenbare
titels per gekozen behavior. Test gelijke namen en meerdere registraties per
bestand. De VS Code-editor-group/serializer-grens is een voorbeeld van het apart
modelleren van editorinputs, pinning en hun herstel; zij schrijft geen specifieke
BMSX-tabnaam voor.
[VS Code editor group](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts).

### A05 — P2: Scenario Lab kan belangrijke resultaattekst alleen afkappen

**Bewijs:** `ide/workbench/contrib/scenario_lab/layout.ts:148-162` kapt resultaatregels
af op de vaste paneelbreedte. Selectie toont de complete log/failure niet in een
detailvlak; activatie opent de bron (`navigation.ts:189-208`).

Een onafhankelijke logfixture op 384×288:

```text
Volledig: ASSERT actor.position.x after the transition to the combat state: expected 128; received 64
Zichtbaar:   LOG T1  ASSERT ACTOR.POSITION.X AFTER THE TRANSI...
Status: VALIDATION
Enter: open-source, tests/audit/validation_assert.lua:1:1
```

De relevante expected/actual-waarden zijn dus niet in Scenario Lab te inspecteren.
De logdata is niet verloren: de presentatie biedt de benodigde leesroute niet.
Dezelfde beperking raakt lange failureteksten. Bovendien meldt ActionEffect-
bronactivatie bij meerdere matches alleen een aantal, hoewel de gedeelde picker
al bestaat (`controller.ts:222-241`). Geen willekeurige bron kiezen is correct;
geen keuze aanbieden laat de gebruiker wel vastlopen.

**Correctie/gate:** scheid compacte resultaatrijen van volledige inspecteerbare
output/details en van bronlocaties. Gebruik de werkelijke opgeslagen log/failure,
geen herberekende boodschap. VS Code heeft daarvoor resultaat-/message-identiteit
en een output/peek-presentatie los van navigatie naar het bronbestand.
[VS Code test output](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/testing/browser/testingOutputPeek.ts).

**Opvolging A05 (2026-09-11):** [resultaatinspectie en bronkeuze](scenario_result_inspection.md)
zijn geïmplementeerd. De pane inspecteert de originele log/failure via het
gedeelde control; de producer fabriceert geen test-regel-1-locatie meer.
Berichtidentiteit overleeft nieuwe logs, echte evictie wist de selectie. De
resultfocus bezit Details en de toolbar gebruikt dit expliciete commandcontext.
Workbench-deactivatie gebruikt de bestaande pane-detach, niet lokale
active-hooks. Meerdere effectmatches openen de gedeelde bronkiezer. De oude
berichtactivatie faalt onafhankelijk in de browser; volledige Studio en
Pietious-navigatie slagen op alle drie renderers. B04-sourcecertainty,
propertyauthoring en volledige-host/per-device-metingen zijn hiermee niet gesloten.

### A06 — P2: gedeelde Quick Pick is nog geen afgeronde zoek-/keuze-UX

**Bewijs:** `ide/workbench/services/quick_input/model.ts:37-66` gebruikt een eigen
substringfilter: tokens moeten letterlijk voorkomen, score is de laagste positie
in samengevoegde label/description/detail. `hot res` vindt `Run: Hot Resume`,
`hr` niet. De renderer heeft maximaal tien zichtbare rijen, maar geen scrollbar
of matchmarkering. Wheel en keyboard kunnen wel door de lijst navigeren.

Symbol-/reference-search heeft daarnaast eigen filter- en popupcode in
`ide/workbench/contrib/code_editor/symbols/search/`. Dezelfde keuzehandeling wordt
dus niet overal door dezelfde control beheerd. Niet ieder soort zoekresultaat
hoeft dezelfde provider, ranking of hoogte te hebben.

VS Code deelt Quick Input, maar laat providers de betekenis van resultaten
houden. Commands gebruiken onder andere woordmatching, highlights en historie;
bestandsranking heeft een eigen scorer. Blind alle soorten zoeken in één
substringlijst stoppen is dus óók geen juiste overname.
[VS Code commands](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/quickinput/browser/commandsQuickAccess.ts#L56-L211),
[file/item scorer](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/fuzzyScorer.ts).

**Correctie/gate:** voltooi de gedeelde lijst/focus/scroll-presentatie en ontwerp
matching expliciet per providerfamilie, met gedeelde bewezen primitives waar
passend. Test korte zoekopdrachten, gelijke namen, veel resultaten, behoud van
selectie en zichtbare matchreden. MRU of extra ranking is op zichzelf geen
architectuurvereiste; de huidige eenvoudige filter is beperkt, niet intrinsiek
een corruptiebug.

### A07 — P2: recovery-backup is nog geen workbench-sessieherstel

**Bewijs:** `ide/workbench/workspace/models.ts:21-31` bevat dirty files en
code-editor-metadata. `autosave.ts:170-183` verzamelt alleen codeviews van dirty
modellen. `restore.ts:35-39,76-81` herstelt die codeviews, geen visual inputs,
gekozen behaviors, graphscroll, tabvolgorde of actieve visual editor.

De autosave-crashfix is daarmee niet hetzelfde als een complete sessiearchitectuur.
Dirty broninhoud kan correct hersteld zijn terwijl de gebruiker haar werkcontext
kwijt is. Dit is een ontbrekend workbench-contract, niet een verzoek om oude
storageformaten te blijven ondersteunen.

**Correctie/gate:** houd working-copy-backups en serialiseerbare editorinputs/viewstate
apart. VS Code's editor-group serialiseert inputs via hun eigen serializers.
Test een nieuwe sessie met schone én dirty bron, meerdere visual inputs en
herstel van actieve selectie; geen compatibility-reader toevoegen.
[VS Code editor serialization](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts#L1163-L1256).

### A08 — Bewijsgrens: performance en alle platformen zijn niet gecertificeerd

De graphproeven meten onder andere retained geometrie, panning en quad-emission.
`graph_navigation_design.md` vermeldt zelf dat complete Studio-frametijd,
DOM-input, Lua-analyse, GPU-rasterisatie en heap/GC-profielen buiten die meting
vallen. Er zijn ook gemeten kostenstijgingen; "nul regressie" is geen geldige
samenvatting van die cijfers.

Rewind gebruikt in TS en libretro twee checkpoints, 1024 journalrecords en een
captureinterval van zes emulatieseconden (`hosts/common/rewind.ts:34` en
`hosts/libretro/rewind.cpp:17`). De keuze is gelijk, maar een gelijk aantal slots
bewijst geen gelijk geheugengebruik of acceptabele capture-/seeklatency op de
SNES Mini. `rewind_architecture.md` meldt terecht dat fysieke Mini-metingen ontbreken.

**Gate:** afzonderlijke metingen van UI input-to-present, analyse/layout,
capture/restore/replay, piekgeheugen en frame-time-spikes op de relevante hosts.
Geen nieuwe compressor of cache introduceren uitsluitend omdat deze metingen
nog ontbreken. Dit is een bewijsgebrek, geen aangetoonde rewind-corruptie.

## Wat behouden moet blijven

- **Canonieke Lua en één working copy.** Scene/Behavior-inputs delen het
  `EditorTextModel`. Bronbewerkingen gebruiken taalowner-primitives en gewone
  undo/redo; de graph wordt niet de tweede waarheid. De nieuwe Source-proef
  veranderde geen bronversie. Het herstellen van een fout in bronranges mag
  deze eigenaar niet vervangen door UI-regelnummercorrecties.
- **Retained graph en capture.** Model, viewport en gestures zijn gescheiden.
  De graph commit pas op drop; capture is aan de startende knop verbonden.
  Volledig uitgeklapte BT's met scrollbars en middle/Space-primary panning passen
  bij de gevraagde workflow en bestaande production-canvaspatronen. Dat de
  toolbar dit nog niet consequent doet is geen reden de graphowner weg te gooien.
  [Godot GraphEdit](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/graph_edit.cpp),
  [ViewPanner](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/view_panner.cpp#L97-L116).
- **Input-owned async layout.** `AsyncGraphLayout` heeft generaties, één lopende
  opdracht en alleen de laatste wachtende aanvraag. Oude resultaten activeren
  geen paneel en publiceren niet over een nieuwe bronversie. Dat is zinvolle
  lifetime-/concurrencylogica, geen defensieve fallback voor kapotte graphdata.
- **Expansie is geen Studio-type.** Beide fysieke sockets bevatten optionele
  concrete ROM/RAM/mailbox-componenten. De host vertaalt media eenmalig; de
  controller bezit selectie en signalen, de kaart haar backing/devices.
  `CART-CLOCKED-DEVICE-01` is expliciet geparkeerd tot een echte kaart bestaat.
  Een speculatieve acceleratorinterface toevoegen zou geen auditfix zijn.
  De scheiding slot/card/device is ook zichtbaar in MAME's cartridge-interface.
  [MAME SNES cartridge interface](https://github.com/mamedev/mame/blob/17d29108c100ff26bf9f9bbe21553ab9034bd8d7/src/devices/bus/snes/snes_slot.h).
- **`installBlua32Media` is nu tooling-media-installatie.** In
  `ide/runtime/lua_pipeline.ts:470-502` installeert het ROM-bytes via de bestaande
  memory/card-owner en actualiseert toolingbronnen. Het is geen machine-API voor
  Studio-objecten of host-Lua-uitvoering. De functienaam alleen bewijst dus niet
  dat de oude workaround is teruggekomen.
- **Rewind/hostpauze gescheiden van gameplay.** Sparse complete checkpoints plus
  geregistreerde externe input en gescheiden seek/playback/takeover zijn een
  passende richting. openMSX onderbouwt record/replay; DuckStation onderbouwt de
  memory-state/GPU-grens. Dat neemt geen MSX-hardwaremodel over en doet geen
  uitspraak over onbekende Clover/Castlevania-internals.
  [openMSX ReverseManager](https://github.com/openMSX/openMSX/blob/25179d6b8d5ec69ad68252f3854721c9a02594eb/src/ReverseManager.cc),
  [DuckStation memory states](https://github.com/stenzek/duckstation/blob/3b30876e92f28faeaba06bcfa562939c7107961e/src/core/system.cpp#L2725-L2775).
- **Geen automatisch oordeel "alle tracing is bloat".** De tien opnieuw gedraaide
  trace/ActionEffect-tests bewijzen onder meer compiler-erasure zonder de
  trace-argumenten te evalueren en echte CPU-gedrags-/budgettests. Dat bewijst
  niet dat iedere omliggende cartlib-refactor nul kosten heeft ten opzichte van
  de oude versie; dat is een afzonderlijke vergelijking.

De huidige Scene Editor is nog een brongebonden compositie-/property-editor,
niet een ruimtelijke sceneviewport of live actor-inspector. BT/FSM-authoring is
eveneens beperkt tot de geïmplementeerde, bewezen sourcebewerkingen. Ontbrekend
zoom, een niet-bewezen dynamische Lua-edge of een nog niet gebouwde runtime-editflow
is niet op zichzelf een workaround. Zo'n volgende feature vereist haar eigen
afgebakende ontwerp; deze audit verzint die niet als zijtaak.

## Validatie en vervolgvolgorde

Opnieuw uitgevoerd:

- 78 geselecteerde tests voor cartridge, focus/actions, navigation, Quick Pick,
  Scenario Lab, behaviorgraph en Lua-source-edits: **78 geslaagd**.
- Trace statements en ActionEffect-runtime: **10 geslaagd**.
- `audit:architecture-boundaries:strict`: **0 issues**.
- `audit:core-parity`: geslaagd. Dit is geen TS/C++ runtime-equivalentiebewijs.
- Studio-tegenproeven A01/A03/A04 en de gerasterde Scene-layoutproef A02.
- Onafhankelijke filter-, actionbar-layout- en Scenario-logproeven.

De checks waren groen terwijl de tegenproeven de bovengenoemde beperkingen
aantoonden. Testdekking moet daarom niet alleen meer voorbeelden van het huidige
gedrag toevoegen, maar de **ontbrekende gebruikerscontracten** toetsen. Sommige
bestaande tests zijn nog sterk gekoppeld aan actuele gamebronnen; hun algemene
invarianten moeten naar zelfstandige fixtures, met aparte echte-cart-smoketests.

Niet opnieuw uitgevoerd: de volledige all-renderer Studio-suite, complete native
runtime-replayconformance, een browser-restartproef voor A07, langdurig GC-/latency-
profilen en fysiek SNES Mini-testen. A07 is vastgesteld via de huidige
producer/restore-contracten, niet via een nagebootste oude autosavepayload.

Auditproeven en volledige outputs staan lokaal onder `/tmp/bmsx-studio-audit/`
(`browser-result.json`, `scene-problems.png`, `probe.jsonl`, test-/auditlogs en
de gebruikte productiebronnen met gepinde revisies in `references/manifest.json`).
De browserproef gebruikt een geïsoleerde workspace; productbronnen zijn niet
gewijzigd. De 404-logs bij workspace-/sourcefetches zijn niet als een geslaagde
"nul console-errors"-gate gepresenteerd.

Voorgestelde correctievolgorde, vóór verdere features:

1. Volledig action-control/focuscontract en volledige paneel-/scrollcontracten.
2. Editor/viewidentiteit en generieke navigation, daarna sessieherstel.
3. Leesbare Scenario-output en voltooiing van gedeelde keuze-/zoekbediening.
4. Onafhankelijke workflowtests en gerichte end-to-end performancegates.

Geen productcode aangepast in deze audit. Niet alles hoeft opnieuw; juist de
nog ontbrekende gedeelde owners moeten worden afgemaakt, in plaats van iedere
bijdrage afzonderlijk te blijven repareren.

## Opvolging

### A01 — gecorrigeerd en beproefd (2026-09-10)

Eén pane-owned `WorkbenchActionBarControl` bedient Lens, Scene Editor, Scenario
Lab en Source Edit Review. Pointercapture en fysieke focus blijven bij de
bestaande services. De focusowner onderscheidt nu expliciet commandcontext van
toolbarfocus, zonder parent-commandfallback of gekopieerde commandhandlers.
Source/Remove/Apply/Cancel voeren pas uit bij geaccepteerd loslaten; verlies van
capture/focus, disablement, Escape en inputvervanging annuleren. Toolbarbediening
werkt met Tab, roving arrows/Home/End en gepaarde Enter/Space. Focus is zichtbaar
in de tiny-fontweergave, niet alleen als een intern vlaggetje.

Ontwerp, bronverwijzingen en reproduceerbare gates:
[`workbench_action_controls_design.md`](workbench_action_controls_design.md).
De eindrun doorliep de werkelijke Studio-workflows en FSM-retarget/review op
software, WebGL2 én WebGPU. De onafhankelijke controltests behandelen ook
coalesced clicks, modifierkeys, disable/re-enable, reentrante navigatie en
behoud van buffers. De volledige Lua-testsuite: **1249 geslaagd, 1 bestaande skip**.
IDE-typecheck, browser-Studio-build, strict architecture boundaries (0 issues),
core-parity en `git diff --check` slagen. De brede tests-typecheck heeft nog
de **51 bestaande diagnostieken**; A01 voegt er geen toe.

**Na A01 bleven A02–A08 open.** A01 sluit geen paneelruimte-, navigatie-, identiteit-,
sessie-, output- of zoekprobleem en bewijst geen volledige host-/SNES-Mini-
performance. De resterende contracten staan afzonderlijk in
[`open_architecture_slices.md`](open_architecture_slices.md#studio-correcties-uit-de-ux-architectuuraudit).

### A02 — gecorrigeerd en beproefd (2026-09-10)

Scene-details gebruiken nu een gedeelde `WorkbenchScrollViewport` met gemeten
inhoud, een gereserveerde scrollbartrack en één content-/schermprojectie.
`Scrollbar` blijft eigenaar van bereik/positie/thumb en interval-reveal;
ook graph-viewports gebruiken nu die reveal-owner. De Scene-layout meet
regels, velden en toelichting uit font en breedte, niet uit vaste schermrijen.
Renderclipping en veldhits gebruiken hetzelfde viewport. De aparte
`WorkbenchScrollControl` bezit capture en keyboardscroll, zonder waarden te
accepteren door wheel of thumbdrag. Focus en resize revealen het juiste veld;
stationaire updates draaien handmatig scrollen niet terug.

Ontwerp en de vooraf bekeken Godot/VS Code-bronnen:
[`workbench_scroll_views_design.md`](workbench_scroll_views_design.md).
De onafhankelijke Lua-fixture staat in `tests/fixtures/studio/scene_viewport.ts`.
Zij test geen regelnummers, namen of gedrag van bestaande game-definities.
De echte Studio-proef gebruikt wel de bestaande ROM/workspace als transport.

**Bewijs:** 20 gerichte viewport/scrollbar/graph-tests; volledige Lua-suite
**1259 geslaagd, 1 bestaande skip**. De daadwerkelijke Studio-workflows slagen
op software, WebGL2 en WebGPU, inclusief beide fonts, meerdere tabrijen,
fysiek resizen van Problems tot nul hoogte, Tab-reveal naar Z, het klikken op
geklipte veldgeometrie, draftbehoud tijdens scroll/capture/Escape, een Z-edit met
document-Undo en de focusroute van een leeg geworden inspector. Tiny- en
MSX-fontscreenshots zijn op alle drie renderers bekeken.
IDE-typecheck, browser-Studio-build, strict architecture boundaries (0 issues),
core-parity en `git diff --check` slagen. De tests-typecheck houdt dezelfde
51 bestaande diagnostieken; geen nieuwe in deze slice.

Stationaire layout en scroll meten geen tekst opnieuw; tekst-/rect-/thumb- en
quadopslag blijven behouden. Dat is gericht bewijs, **geen** volledige host- of
SNES-Mini-performancemeting. A03–A08 blijven afzonderlijke open contracten.

### A03 — gecorrigeerd en beproefd (2026-09-10)

De bestaande Back/Forward-owner bewaart nu de concrete editorbestemming en
een optionele bijdrage-eigen selectie. Code/resource-inputs hebben een
geregistreerde heropenroute; niet-heropenbare visual-inputs verliezen hun
history-inschrijvingen bij disposal. Selecties en hun bronabonnementen worden
vrijgegeven bij duplicaten, eviction, branch pruning, consumption en shutdown.
Er is geen aparte Lens-stack. `Go: Back`/`Go: Forward` en Alt+Left/Right zijn
workbench-commands, niet meer uitsluitend code-editor-keybindings.

De concrete pane consumeert haar restore-optie tijdens één activatie, vóór
controlbinding. Bronbookmarks behouden registratie, BT-occurrencepad of exacte
FSM-return/binding; zij bewaren geen oude graph/AST. Asynchrone FSM-layout
consumeert de bewaarde viewport na publicatie. Scene-members en Scenario-tests/
results gebruiken eveneens hun eigen selectie-identiteit. Een verdwenen bron
of geëvicte resultaat krijgt niet de volgende ordinal of een gelijknamige node.

De volledige Studio-regressie onthulde bovendien dat externe bronedits een
verborgen codecursor op verwijderde regels konden achterlaten. De oude
history-clamp verborg dit. `CodeEditorViewBinding` volgt daarom bij de
textmodelgrens ook edits zonder code-eigen editstate; expliciete code-Undo/
Redo-resultaten blijven leidend. Visuele wrap-scrollrows zijn geen bufferregels.
Er is geen extra grenscontrole of reparatiepad aan de history-consumer toegevoegd.

Ontwerp, de vooraf bekeken VS Code/CodeMirror-productiebronnen en reproduceerbare
gates: [`workbench_navigation_history_design.md`](workbench_navigation_history_design.md).
De onafhankelijke `navigation.ts`-fixture beproeft echte Studio-input, FSM-worker,
Source/Definition/Back/Back/Forward, UTF-16-prefixedits, gedeelde BT-occurrences,
verwijdering/Undo, ActionEffect-properties, Scene-members, Scenario-bronnen en
gesloten source-tabs. Versie/dirty/modelbytes en gepauzeerde machine/media zijn
expliciete orakels. Een afzonderlijke resultaatproef toetst logevictie en bewaarde
collapsed-state, zonder een bepaalde game-scenario uit te voeren.

**Bewijs:** volledige Studio-workflows geslaagd op **software, WebGL2 en WebGPU**;
Lua-suite **1272 geslaagd, 1 bestaande skip**. IDE-typecheck, browser-Studio-build,
strict architecture boundaries (0 issues), core-parity en `git diff --check`
slagen. De tests-typecheck houdt exact dezelfde **51 bestaande diagnostieken**
als na A02 (vergeleken zonder verschoven regelnummers). Eindlogs en screenshots
staan lokaal onder `/tmp/bmsx-a03/`. De suite bevat opzettelijke compile/guestfaults
en bestaande sourcefetch-404's; dit is geen claim van nul consolemeldingen.

Stationaire frames capturen of remappen geen history; stacks zijn begrensd op
64 entries elk en mapping gebruikt modelwijzigingen. Dit is geen volledige
host-/SNES-Mini-performancemeting. **A04–A09 blijven open**: A03 verandert niet
de definitiegranulariteit van tabs, preview/pinnen, sessieherstel, Scenario-output,
zoekbediening of hover-leave.

### A04 — gecorrigeerd en beproefd (2026-09-10)

Een Behavior-input bezit nu één registratie-occurrence, niet het gehele bestand.
Afzonderlijke FSMs, BTs en ActionEffects blijven naast elkaar open; opnieuw openen
van dezelfde overlevende occurrence bewaart selectie en viewport. Het gedeelde
textmodel, undo-verleden, source-topologie, FSM-index en gemapte bronindex worden
niet per view gedupliceerd. Een modelwijziging wordt per gedeelde bronindex eenmaal
gemapt. Undo in een zusterview neemt niet langer de registratie van de bewerking
over. Hernoemen/prefix-edits volgen de bestaande correspondentie; een verwijderde
registratie wordt geen volgende ordinal of gelijknamige vervanger.

De workbenchgroep bezit één expliciete schone Preview. Open/Keep Open, tab-
double-click, tabdrag en een dirty working copy behouden de input. Een vervangen
preview wordt pas na pane-detach gesloten; ook een al gecapturede history-entry
van die gesloten input wordt niet meer gepubliceerd. Tabtitels benoemen de
definitie; de groep voegt bij gelijke titels bronbeschrijvingen toe.

De complete regressie onthulde een echte prerequisite: meer behouden tabs lieten
de oude onbeperkte tabrijen alle editorruimte innemen, tot Problems niet meer
te resizen was. De gedeelde tabstrip is daarom één geclipte horizontale rij met
scrollbar geworden, niet een test die tabs sluit om ruimte te maken. Wheel/thumb
behouden editorfocus; actieve reveal draait handmatig scrollen niet terug.
Tabdrag gebruikt de bestaande capture-service, host-time edge-scroll en zichtbare
insertion feedback; alleen de geaccepteerde drop wijzigt de groepvolgorde.

Ontwerp, de vooraf gelezen gepinde VS Code-bronnen en reproduceerbare gates:
[`workbench_definition_inputs_design.md`](workbench_definition_inputs_design.md).
**Bewijs:** volledige Studio-workflows geslaagd op **software, WebGL2 en WebGPU**,
inclusief onafhankelijke definitie-/preview-/Undo-fixtures, fysieke wheel/thumb/
tabdrag, source/Back/Forward en Scene/Problems met een overvolle tabstrip bij
beide fonts. Lua-suite: **1285 geslaagd, 1 bestaande skip**. IDE-typecheck,
browser-Studio-build, strict boundaries (0 issues), core-parity en `git diff
--check` slagen. De tests-typecheck behoudt exact de **51 bestaande diagnostieken**.
Logs en screenshots staan lokaal onder `/tmp/bmsx-a04/`; de browserproef bevat
opzettelijke compile/guestfaults en bestaande sourcefetch-404's.

De gerichte proeven controleren gedeelde generaties, eenmalige mapping,
retained labelmetingen, zichtbare-only painting en disposal van tabgeometrie.
Dit is geen volledige host-/GC-/SNES-Mini-performancemeting. **A05–A09 blijven
open**, inclusief workbench-sessionserialization los van recovery-backups.

### A09 — aanvullend P2: pointer-leave — gecorrigeerd

Bij de A02-review is in de echte software-Studio ook deze tegenproef uitgevoerd:
Source hoveren en daarna de pointer zonder klikken naar Problems verplaatsen.
`actionBar.hoveredCommand` blijft `sceneEditor.source`, terwijl de pointer het
control heeft verlaten. Dit is een presentatieprobleem, geen herhaalde
command-uitvoering. Capture-cancel/release uit A01 is een ander contract.

De router in `ide/input/pointer/dispatch.ts` stuurt de nieuwe pointer naar het
paneel dat hem afhandelt; het vorige control krijgt geen leave-notificatie.
`WorkbenchActionBarControl` kan zijn hover alleen bij een eigen inputevent of
capture-cancel bijwerken. Een Scene-lokale clear of rondgestuurde nep-snapshot
zou hier opnieuw om de ontbrekende input-owner heen werken.

**Correctie (2026-09-11):** de gedeelde hover-owner volgt Qt Quick's
generatiegemarkeerde hitroute; een overgeslagen control ontvangt leave aan het
eind van de dispatch. Detach/hide/shutdown leveren leave direct. De echte oude
Studio faalt op Source → Problems; de correctie doorloopt Problems/chrome/menu/
palette/canvas-verlaten/hide op software, WebGL2 en WebGPU, met beide fonts.
Leave verandert geen focus, keyboardselectie of capture. Negen nieuwe gerichte
tests en de volledige Lua-/Studio-proeven toetsen de eigenaren; de absolute
microbenchmark wordt niet als volledige host-/GC-meting gepresenteerd. Zie
[`editor_pointer_hover.md`](editor_pointer_hover.md) voor bronreferentie, scope,
lifetime, kosten en expliciet resterende UX-beperkingen. **A05–A08 en B03/B04/
B06-authoring blijven open.**

### Aanvullende behavior-gebruikersreview na A04 (2026-09-10)

De gebruikersproef bevestigt de bruikbare basis van graphdrag en Undo, maar toont
andere open contracten: echte BT-reparenting, betekenisvolle kaartinhoud,
FSM-entrypresentatie, algemene multi-filebronprovenance, contextmenu's,
ActionEffect-inspectie/-bewerking en zoom. Dit zijn geen alsnog geslaagde gates
van A01–A04 en niet uitsluitend cosmetische wensen.

De [behavior-review en eindcontracten B01–B07](behavior_authoring_ux_review.md)
leggen de live oorzaken, opnieuw gelezen productievoorbeelden en bouwvolgorde
vast. Vier onafhankelijke Lua-tegenproeven bevestigen onder meer het verschil
tussen beschikbare transferanalyse en ontbrekende reparent-UI, de filelokale
FSM-resolutie en de dubbele requirementweergave. De generieke Lua-frontend kent
in de twee-bestandenproef het target al; de behavior-reader consumeert die
workspace-bronkennis nog niet. **Audit/ontwerp, nog geen
productiecodecorrectie.** A05–A09 blijven daarnaast open.

### Verdieping: broncontract vóór ruimere authoring (2026-09-10)

De [broncontractanalyse op `592c86a94`](behavior_source_authoring_design.md)
toetst daarnaast equivalent geschreven Lua, overschreven API-exports, wrappercalls,
value identity en evaluatievolgorde. Vijf onafhankelijke tegenproeven bevestigen
dat const-binding geen immutable export bewijst, één bekend callable geen
completeness garandeert en lexical relocation geen effectbehoud is. De CPU-proef
verandert een niet-verplaatste siblingwaarde van `2` naar `1`, terwijl gewone
Undo de bron correct herstelt.

Dit scherpt B04 aan tot een generiek source-query-/resourcecontract vóór ruimere
structurele authoring in B03; niet alleen vóór multi-file-UX. TypeScript/Roslyn
leveren het voorbeeld voor brongebonden, operationele refactoranalyse en VS Code
voor resource-owned edit/Undo. Hun architectuur rechtvaardigt geen tweede Lua-
solver, universele omkeerbaarheid of workspace-transactionmanager voor één
imported-field-edit. **Nog steeds analyse/ontwerp, geen productiefix.**

### A06 — lijstinteractie en popup-capture (2026-09-11; gedeeltelijke uitvoering)

De gedeelde picker gebruikt nu de bestaande pixel-scrollviewport en dezelfde
axis-only scrollbar-gesture als andere scrollviews. Haar thumb behoudt queryfocus;
rijactivatie gebeurt op release over de werkelijk ingedrukte rij. Querywijziging,
nieuwe geometrie, buitenrelease en sessie-einde annuleren. Ctrl+Home/End bedient
lijstgrenzen zonder gewone Home/End-tekstediting over te nemen. Capture heeft een
surface-scope: een popup blokkeert achtergrondgestures, niet zijn eigen scrollbar.
Tekstvoorbereiding is zichtbaar-bereikgebonden en blijft gecachet per font/breedte.

De oude press-time-route faalt onafhankelijk op `f853f9681`. De volledige Studio-
en Pietious source/graph/Undo-browsergates slagen op alle drie renderers, naast
1544 geslaagde Lua-tests en één bestaande skip. De tests-typecheck behoudt zijn
51 bestaande diagnostieken. Owners, productievoorbeelden, profiler en exacte
bewijsgrenzen staan in [quick_input_interaction.md](quick_input_interaction.md).
**A06 blijft open:** provider-eigen matching/highlights en symbol-/locationkeuzes
zijn hiermee niet gemigreerd of gerepareerd.

### A06 — providerqueries en commandwoorden (2026-09-11; gedeeltelijke uitvoering)

Providers publiceren nu een eigen getypeerde catalogus, geordende matches en
actieve resultaatindex. De control filtert of sorteert niet opnieuw. Het model
consumeert de projection direct en maakt alleen renderdata voor werkelijk
gepresenteerde keuzes, niet voor een tweede volledige catalogus. Commandmatching
volgt de VS Code-woordrecurrence en geeft volledige/substringmatches prioriteit
boven losse woordinitialen; files en behavior-keuzes houden een expliciete
letterlijke tekstpolicy. `hr` vindt Hot Resume zonder een commanduitzondering.

De oude owners op `82cdf14ed` falen de echte `hr`-tegenproef. De volledige Studio-
en Pietious browsergates slagen op software, WebGL2 en WebGPU; de Lua-suite heeft
1548 geslaagde tests en één bestaande skip. Tests-typecheck: dezelfde 51 bestaande
meldingen. Zie [quick_input_providers.md](quick_input_providers.md) voor eigenaars,
referenties en bewijs. **A06 blijft open** voor matchmarkering, file/symbol-
matching en de symbol-/locationcontrolmigratie; deze querygrens sluit die niet.

### A06 — symbolen en bronlocaties op Quick Input (2026-09-11; gedeeltelijke uitvoering)

De afzonderlijke globale symbolen-/referentie-/definitiepopup is verwijderd,
inclusief eigen input, pointer/hover, inline-layout, renderer en de uitgestelde
navigatie-microtask. Providers behouden echte symbolen, definitietargets en
snapshot-bronranges. Geen kunstmatige `LuaSymbolEntry` voor een referentielocatie.
De gewone Quick Input-lifetime sluit vóór bronactivatie en bij bronwijzigingen
in de vastgelegde Lua-domain of SYSTEM. Bestandspaden blijven onderscheidbaar;
document-symbolen herhalen niet hetzelfde bestand op elke rij.

De oude selectiebug is onafhankelijk op `f1ae09edc` gereproduceerd: de cursor
stond in de gebruiksbron op regel 6, maar de referentiekeuze selecteerde regel 7
van het definitiebestand. Een file-local highlightindex werd gebruikt als een
workspace-catalogusindex. De nieuwe provider kiest op pad en cursor-containment;
file-local highlights blijven een eigen, tijdelijk zichtbaar resultaat.

Zie [`source_quick_access.md`](source_quick_access.md) voor productievoorbeelden,
contract en bewijs. **A06 blijft open** voor file/symbol-matching en zichtbare
matchredenen; deze migratie claimt geen fuzzy- of Peek-editorimplementatie.
B03/B04/B06-authoring, A07 en het bredere A08-bewijs blijven eveneens open.

### A06 — query-eigen matchmarkering (2026-09-11; gedeeltelijke uitvoering)

Providers publiceren nu de echte gematchte tekstbereiken in hun displayvelden.
Woordmatching herstelt de matchposities uit dezelfde retained recurrence;
letterlijke matching behoudt bereiken en materialiseert alleen toegelaten
resultaten. De gedeelde spanopslag houdt queryresultaten los van de gesorteerde
rijpositie. Case-folding bezit haar terugvertaling naar oorspronkelijke UTF-16-
posities. Geen zoekpass of lowercase-offsetinterpretatie in de renderer.

De gedeelde highlighted label behoudt zichtbare glyphadvances en tekst-runs;
querywijziging vervangt de markering zonder tekst opnieuw te meten. Ellipsis
is geen brontekst. De kleurparen voor geselecteerde/niet-geselecteerde matches
komen van de theme-owner. Tekst wordt met de bestaande overlay-span-API getekend,
zonder per-frame substrings. Er is geen tweede picker- of matchingframework.

De echte oude Studio op `1eef4a5bc` faalt op de ontbrekende `H`/`R`-markering
voor `hr`; de huidige fysieke proef slaagt met beide fonts en alle drie renderers.
De volledige Studio- en Pietious source/graph/Undo-gates slagen na de laatste
rangecorrectie op software, WebGL2 en WebGPU; Lua: 1560 pass, één bestaande skip.
Tests-typecheck behoudt de 51 bestaande diagnostieken. De gemeten onnodige
tekenexpansie is vóór landing bij de matcher weggehaald, niet gemaskeerd met een
cache of querylimiet. Zie [quick_input_highlights.md](quick_input_highlights.md)
voor referenties, exacte grenzen en de gecontroleerde kostenvergelijking.

**A06 blijft open voor file/symbol-fuzzymatching.** B03/B04/B06-authoring, A07
en het bredere A08-bewijs zijn hiermee niet gesloten.

### A06 — bestandsnamen en paden (2026-09-12; gedeeltelijke uitvoering)

Bestandskeuzes hebben nu een eigen provider met de VS Code `scoreFuzzy`-
recurrence en identity/basename/path-prioriteiten. De matrix en matchposities
blijven behouden; het UI-contract, bronresource en domain blijven ongewijzigd.
Kind/socket-metadata is context, geen tweede filename. Alle querytermen moeten
matchen; onmogelijke subsequences worden bewezen verworpen vóór de matrix,
zonder timeout, cap of per-toets-workspacequery.

De oude echte Studio op `a05a3e879` faalt op de afkorting `tscr`. De huidige
fysieke file/highlight/resource/Back/Undo-proef én de volle Studio- en Pietious-
navigatiegates slagen op software, WebGL2 en WebGPU. Lua: 1568 pass, één bestaande
skip; IDE typecheck, audits, indentation en browserbuild slagen. Tests-typecheck:
dezelfde 51 bestaande diagnostieken. De gemeten breedste query kost 0,143/1,170/
10,202 ms voor 128/1024/8192 files op de ontwikkel-PC, niet op de SNES Mini.
Zie [file_quick_access.md](file_quick_access.md) voor eigenaar, referenties,
querypolicy, oracle en de precieze meetgrenzen.

**A06 blijft open voor symbol-fuzzymatching.** Dit sluit B03/B04/B06-authoring,
A07 of het bredere A08-bewijs niet.

### A06 — symbolquerypolicy en afsluiting (2026-09-12)

Document- en workspace-symbolen hebben nu de aparte VS Code
`fuzzyScore`/`scoreFuzzy2`-policy. Gekwalificeerde symbolen blijven naamdata;
workspacevragen kunnen daarna het bronpad kwalificeren. Kind/regelmetadata wordt
niet per ongeluk als symboolnaam gezocht. Nul en negatieve scores zijn gewone
matches. Source-discovery, echte declarations, domaincapturing en invalidering
blijven bij de bestaande owners; typen maakt geen nieuwe workspacequery.

De matrix gebruikt bewezen minimale/maximale matchposities en retained opslag,
zonder de upstream 128-character truncatie. De onafhankelijke oracle toetst
scores en alignments. Bestands- en symbolproviders delen nu de veldlokale
range-union bij Quick Input, niet hun verschillende zoek-/sorteersemantiek.
De gemeten overbodige singleton-mergepass is daar vóór landing verwijderd.

De oude echte Studio op `3c016ae3a` faalt op de onafhankelijke `SHDW`-proef.
De nieuwe symbol/source/Back/Undo-smoke, de volledige Studio-workflow en de
Pietious source/graph/Undo-gate slagen op software, WebGL2 en WebGPU. Lua: 1576
pass, één bestaande skip. IDE/audits/indent/browserbuild slagen; tests-typecheck
behoudt dezelfde 51 bestaande diagnostieken. Zie
[symbol_quick_access.md](symbol_quick_access.md) voor kosten, referenties en
expliciete grenzen; de 8192-symbolen-brede query kost hier circa 7,7 ms en is
geen low-end-hardwarebewijs.

**A06 is voor zijn beschreven correctie/gate uitgevoerd:** gedeelde control,
focus/scroll/capture, provider-owned ranking, zichtbare matches en gemigreerde
symbol-/locationkeuzes. MRU, typo-correctie of een volledige VS Code-clone zijn
geen stilzwijgende beloften. **B03/B04/B06-authoring, A07 en A08 blijven open.**

### A07 — source/input/group admission (2026-09-12; gedeeltelijke uitvoering)

De live owner-pass vond een ontbrekende grens vóór serialisatie: de ingebouwde
`ResourceEditorResolver`-factories voegden tijdens resolve al tabs toe; recovery
gebruikte zo een editor-input om alleen een working copy te laden. Dat is nu bij
de owners gescheiden, naar de text-model-manager en editor-group opening van
VS Code, niet met een serializer die die bijwerking verbergt.

- Recovery resolve/hydrate van Lua/AEM-modellen maakt geen verborgen code-input.
  Alleen expliciete code-viewmetadata maakt in het huidige formaat zo'n view.
- Ingebouwde editor-resolve verandert de tab-membership niet; toelating en
  pane-activatie verlopen via de tabgroep. Gelijktijdige kandidaten met dezelfde
  inputidentiteit houden één view over en geven de ongebruikte input vrij.
- Bron-openen en history gebruiken deze grens. Back activeert een bestaande
  visual preview zonder haar impliciet permanent te maken.
- De modelservice deelt een lopende AEM-source-read per volledige resource-id;
  een mislukte read blijft een fout en een oude workspace-generatie kan na
  teardown geen model in de nieuwe generatie publiceren.

Bewijs: de oude echte Studio faalt op de nieuwe no-membership-mutation-proef;
nieuwe gerichte én volledige Studio/Pietious-proeven slagen op alle drie
renderers. Lua **1582 totaal / 1581 pass / 1 bestaande skip**, IDE-tsc, audits,
indent en browserbuild slagen; tests-tsc behoudt dezelfde 51 baseline-diagnostieken.
Zie `workbench_session.md` voor owners, referenties, gevonden tussenregressie en
exacte bewijsgrenzen.

**A07 blijft open:** contribution-owned serialiseerbare viewstate, input/group
serializers, herstel van clean/visual context en de echte browser-restartgate.
B03/B04/B06-authoring en A08 worden hiermee niet afgesloten.


### A07 — contribution-owned sessions (2026-09-12; afgerond)

`editorGroup` bewaart geordende input-envelopes en active/preview, onafhankelijk
van dirty bronbackups. Elke bijdrage bezit haar eigen serializer en hergebruikt
de gewone navigatie-bookmarks. Schone code, scene-selectie, twee BT/FSM-views van
één working copy, resource-viewers en Scenario Lab-testcontext overleven een echte
page reload. Pas de actieve pane wordt gekoppeld; grafiekpositie wacht op actuele
geometrie. Geen runtime-/Undo-/worker- of ongeldige widgetdraft in de sessie.

De reloadproef vond een code-widgetafhankelijkheid van niet-codepanes. Cleanup
staat nu bij de uitgaande codepane; workbench-bounds hebben geen tekstmodel nodig.
Pagehide neemt alleen geaccepteerde staat op, shutdown doet normale focus-detach
vóór de snapshot en dispose pas erna. Een gewijzigd bronfingerprint houdt oude
posities buiten nieuwe bytes; geen alternatieve definitie of compat-reader.

Bewijs: **1590 Lua-tests, 1589 pass/1 bestaande skip**, dezelfde 51 tests-tsc-
baseline, IDE-tsc/audits/indent/build/diff groen. Echte reload én volledige Studio/
Pietious-navigatie groen op software/WebGL2/WebGPU. Een gerichte capture+JSON-proef
meet circa **0,566 ms warm voor 384 inputs**; geen herlezing van stabiele bron.
Dit meet geen storage-IO, volledige frames of fysieke SNES Mini. Referenties,
alle gates en meetgrenzen staan in `workbench_session.md`.

**Open blijven:** resource-viewer content/scroll bij opnieuw resolven,
B03/B04/B06-authoring en A08. De opgeslagen sessiestructuur is vervangen zonder
migratie van oude IDE-records, zoals afgesproken.


### A07 follow-up — resourcecontent vervangt geen viewstaat

De bij A07 gevonden reset bij opnieuw resolven is opgelost bij de producent:
`buildResourceViewerContent` maakt alleen vernieuwbare inhoud. `ResourceViewerInput`
behoudt één view en werkt content/label bij zonder scroll te schrijven. Geen
capture/restore om de oude verkeerde statevervanging heen en geen stale-content
shortcut. VS Code-mediarefs en scope staan in `workbench_session.md`.

**78/78** gerichte tests, **1591 Lua-tests / 1590 pass / 1 bestaande skip**, drie
backend-reloadproeven en normale type/audit/build-gates bewijzen deze grens.
De resource-viewer content/scroll-koppeling is hiermee gesloten. De pre-existente
metadataformatting/uitgeschakelde image-preview is niet herontworpen;
B03/B04/B06-authoring en A08 blijven open.

### B04 — vaste toegangspaden versus groeiende feiten (2026-09-12)

De gedeelde taalowner onderscheidt nu geinternde padidentiteit, ontbrekend pad
en groeiende waarde-/prototyperelatie. Een positieve padlookup krijgt geen
afhankelijkheid van andere paden; een negatieve lookup volgt precies haar
kind/base/operand. Indexcollecties en feitrijen blijven wijzigingen volgen.
De leegte van een monotone relatie is geen abonnement op iedere latere rij.
Dit volgt de lifetimegrens van Salsa's interned slots, zonder een Lens-cache.

De onafhankelijke groeiproef gaat van 5120 naar 768 evaluaties bij 256 bases.
De echte koude workspace-query blijft in de gepaarde proef circa 257 ms; sommige
kleine queries worden duurder. Dit is dus geen algemene latency-overwinning.
**1598 Lua-tests / 1597 pass / 1 bestaande skip**, type/audit/build-gates en alle
negen backend-workflow/reloadgates zijn groen binnen hun beschreven scope.
Zie `lua_interned_dependency_lifetime.md` voor referenties, kosten, de herhaalde
recoverygate en meetgrenzen. **B03/B04/B06-authoring en A08 blijven open.**
