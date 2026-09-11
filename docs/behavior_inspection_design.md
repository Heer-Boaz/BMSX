# Behavior-inspectie: B01 en de leesroute van B06

## Referenties en gemeten ruimte

VS Code [`PeekViewWidget`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/peekView/browser/peekView.ts)
houdt een lokale header/actionbar en body, met expliciete sluiting en lifetime;
een Quick Pick is niet de body voor volledige inhoud. Godot
[`EditorProperty::get_minimum_size`](https://github.com/godotengine/godot/blob/cb41ea115914c61a8329087b4cffbad7477b8427/editor/inspector/editor_inspector.cpp)
meet de volledige editor onder de propertykop in plaats van alle waarden tot
een vaste korte lijstregel te beperken. De implementatie volgt deze scheiding,
niet hun desktopafmetingen of runtime-reflectie.

Werkelijk gemeten vóór implementatie in Studio: 384×288, tiny-font met
lineHeight 6. Het FSM-canvas is 381×238; met Problems open 381×202. Screenshots
en ruwe bounds: `/tmp/bmsx-behavior-details/measurement.log`, `problems-*.png`.
Een permanent zijpaneel zou de beschikbare diagrambreedte opnieuw halveren.
Daarom neemt Details op deze resolutie tijdelijk de volle bijdragebreedte in,
met Source en Back in de bestaande actionbar. Graphmodel, selectie en pan blijven
retained; er wordt geen tweede graphinput of extra tab aangemaakt.

## Owners

- De bijdrage produceert getypeerde bron-/bewijsdetails, onafhankelijk van
  QuickPickItem. Een detail houdt zijn echte occurrence/range. Volledige tekst
  wordt uit de bijbehorende canonical sourcegeneratie gelezen, nooit uit de
  toevallig actieve code-editor.
- De gedeelde property-inspector consumeert dezelfde displayvelden als de
  property-tree, maar als volledige, variabel hoge tekstblokken. Label, waarde
  en toelichting zijn meetbare inhoud in één scrollviewport, niet een vaste
  drie-regels-preview. De compacte property-tree blijft een overzicht/control;
  hij wordt niet vermomd als een complete reader.
- Scrollbar, capture, focus en actionbar blijven bestaande workbench-owners.
  Meten/wrappen gebeurt bij nieuwe inhoud, font of breedte; scroll/hover/paint
  maakt geen nieuw tekstmodel, syntaxprojectie of geometrie.
- Pijlen kiezen properties; Page Up/Down leest een lange waarde zonder de
  selectie over te slaan. Controller up/down doet hetzelfde; LB/RB bladert,
  A opent Source bij release en B keert terug. Deze routes horen alleen bij het
  gefocuste IDE-control, nooit bij gameplay. Pointerselectie alleen opent geen
  bron en schrijft geen tekst. De Source/Back-actionbar gebruikt dezelfde
  release-, focus- en commandroute als de rest van de workbench.
- Een lokale inspectiesessie houdt het getoonde document vast. Bronwijziging
  trekt de sessie in; Source/Back/detach beëindigt haar subscriptions. Het menu
  en de reader zijn verschillende controls, niet verschillende command-APIs.
- De huidige behavior-producer is nog single-document. B04 moet dependencies
  en resource-owned origins leveren vóór bredere broninferentie/authoring.
  Deze reader introduceert geen actieve-bufferfallback voor vreemde ranges.

## Presentatie

BT-kaarten krijgen type en authored taak/timeline/duur, niet CHILD n. Gewicht en
main/background-rollen blijven zichtbaar. FSM-kaarten houden naam/structurele
rol en een compacte aanwijzing voor onopgeloste bron. Bewijssoort, bronbestand,
exacte range, guards en onbekende bijdragen blijven in Details. Geen no-path-
waarschuwing voor callbacks die eenvoudig geen transitie retourneren.

## Bewijs

Volledige lange/multiline waarden, scroll/hits/focus op tiny-resolutie met Problems,
Source/Back en annuleren zonder sourceversie/dirty/Undo of machineclockwijziging.
Onafhankelijke authored fixtures; daadwerkelijke software/WebGL2/WebGPU-flow.
Zonder deze gate is de B01-gebruikersflow niet afgerond.

De onafhankelijke bronfixture bevat een echte taskreferentie en een inline
callback van 70 regels. De browserproef opent Problems, leest voorbij de
viewport, controleert retained rows/graph/pan/selectie, houdt Source ingedrukt,
gaat via gewone navigatie terug en verwijdert alleen zijn eigen bronwijziging
met één Undo. FSM-fixtures houden guards, identieke returnbewijzen, unknown
callbacks en impliciete entry zonder verzonnen bronveld inspecteerbaar.
De controls meten niet opnieuw bij 100 ongewijzigde updates; paint bezoekt alleen
zichtbare rows/regels. Dit is gerichte layout-/renderbewijsvoering, geen
volledige host-/GC- of fysieke SNES Mini-performancemeting.

Validatie: 1.405 Lua-tests geslaagd, één bestaande skip (1.406 totaal);
IDE-typecheck en browser-Studio-build groen. Tests-typecheck behoudt dezelfde
51 bestaande diagnostics. De echte Pietious-navigation en volledige Studio-
workflow slagen op software, WebGL2 en WebGPU, inclusief de bestaande
Save/Hot Resume/Reboot-keten. Extra WebGPU-captures van het compacte FSM en de
inspector bovenaan en diep in de callback zijn visueel bekeken; Problems blijft
zichtbaar en de volledige callback blijft bereikbaar. De rendererproeven zijn
correctheidsproeven, geen fysieke GPU-performanceclaims. Strict architecture-
audit: 0 issues; core-parity, indentation en diff-check groen.
