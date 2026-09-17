# Overdracht aan Claude: ontwikkelen uitsluitend via BMSX Studio

Datum: 18 september 2026. Werkmap: `/home/boaz/BMSX`.
Overdrachtsbasis: branch `fix/workspace-session-record-validation`, commit
`34db90e8d`. Controleer bij overname de actuele branch en wijzigingen; reset
niets naar deze commit. Dit document beschrijft de volgende gebruikersproeven,
niet een opdracht om alle eerdere architectuurplannen opnieuw te implementeren.

## Opdracht

Ontwikkel een concrete uitbreiding van een bestaande cart alsof je een gebruiker
van de ingebouwde IDE/Studio bent. Ontdek de benodigde project-API's daar,
bewerk de bron daar, debug daar en beoordeel het draaiende spel. Het doel is
bewijzen dat Studio een bruikbare ontwikkelomgeving is en precies vastleggen
waar die omgeving nog tekortschiet.

Begin met een korte controle van de herstelde 2024-debugworkflow. Ga daarna
door met een betekenisvolle Nemesis-uitbreiding. Werk zelfstandig door zolang
de volgende handeling binnen deze opdracht mogelijk is. Vraag geen toestemming
voor iedere bronedit, save, debuggerstap of normale testactie.

## Wat eerder werkelijk is gedaan

De **2024-proef** gebruikte screenshots en keyboard-/pointeracties in het echte
browserproduct. Cartbron werd niet via de shell gelezen of gewijzigd; er was
geen `page.evaluate`, directe modelbewerking of clipboard-injectie. Via een
breakpoint in `begin_quiz`, runtime-hovers en de assertion-stack bleek dat de
navigatietest te vroeg controleerde na korte inputpulsen. De test is in Studio
aangepast en opgeslagen. Debug en Run slaagden, ook na een volledige page reload.

De **latere brede regressietests** zijn iets anders. Die bedienen productie-UI,
maar gebruiken ook testharnesses, directe working-copy-edits en guest-state-
asserties. Ze zijn waardevol als regressiebewijs, maar **geen bewijs van een
uitsluitend via zichtbare Studio-bediening uitgevoerde ontwikkelsessie**.
Presenteer ze nooit als vervanging van de opdracht hieronder.

Recente reparaties die je niet opnieuw hoeft te verzinnen:

| Commit | Reparatie |
| --- | --- |
| `63519275a` | Scenariofouten behouden hun oorspronkelijke stack; Debug houdt de mislukte uitvoering inspecteerbaar. Scenario-admission volgt werkelijke loaderpublicatie in plaats van vijf ticks wachten. |
| `10c836a90` | 2024-navigatietest volgt de bereikte navigatiestatus; vraagindex en portretcontroles blijven behouden. |
| `129645450` | Bronrebuild onderscheidt assettype én id: `intro.lua` overschrijft niet langer texture `intro`. |
| `3f5844aec` | `rom_dir` vernieuwt zijn afgeleide directorycaches via bestaande `<init>`-voorbereiding na bronreload. |
| `34db90e8d` | Brede regressies volgen echte input-/navigatiestatus en testen doorspelen en nieuwe vijanden na Hot Resume. |

Op deze basis slagen de volledige geautomatiseerde Studio-workflow, de
Nemesis-sceneproef en scenario-debugproeven op software, WebGL2 en WebGPU.
Ook 22 gerichte directory/init/source/texture/media-tests, de productie-
TypeScript-build en architectuurcontrole slagen. Het testproject heeft nog
67 bestaande TypeScript-diagnostieken; de laatste wijzigingen voegden geen toe.
Dit bewijst niet dat alle Studio-functionaliteit of iedere cart foutloos is.

## Grenzen van de gebruikersproef

| Toegestaan | Niet toegestaan als sluiproute |
| --- | --- |
| Screenshots bekijken; zichtbare controls aanklikken; toetsen indrukken/loslaten; scrollen; tekst stapsgewijs typen in de editor | Cartbron buiten Studio lezen met shell, externe editor, zoektool of bestand-API |
| Bron ontdekken via resourcepicker, symboolzoeken, Ctrl+klik, completion, hovers en zichtbare bronlinks | Vanuit voorkennis of een externe codezoekactie een volledige oplossing maken en vervolgens in de IDE plakken |
| Breakpoints, stack/Details, runtime-hovers, code-stepping, frame-stepping, rewind, Actor Lab en ingebouwde Terminal | DevTools, browserconsole, `page.evaluate`, private hostobjecten, CPU/register/heap-uitlezing via een extern script |
| Save, Undo/Redo, Hot Resume, reboot en Scenario Lab via hun zichtbare opdrachten | `EditorTextModel.pushEditOperations`, harness-`openLuaSource`, rechtstreekse workspace-HTTP-calls, runtime-injectie of externe Lua-evaluatie |
| Kleine tekstinvoer via echte keyboard-events, aansluitend op bekeken bron en completion | Clipboard-injectie, DOM-`fill`, `insertText` of een extern gegenereerd codebestand als bulk-invoer |

Normale programmeerkennis is uiteraard toegestaan. De **projectspecifieke**
signaturen, lifecycle en toepasselijke scene-/prefab-API's moet je aantoonbaar in
Studio ontdekken. Bewaar voorbeelden van de completion of definitienavigatie
waarop een keuze berust. Als iets onvindbaar is, rapporteer die beperking in
plaats van ongemerkt over te stappen op repositoryzoekwerk.

Met Terminal wordt hier de **ingebouwde BMSX-terminal** bedoeld. Gebruik die
voor beschikbare gebruikerscommando's, niet om alsnog via een willekeurige
bestanddump of eval de IDE-proef te omzeilen.

Er zijn twee beperkte uitzonderingen buiten de gebruikersproef:

1. **Voorbereiding:** instructies/documentatie lezen, Git-status bekijken,
   bestaande producten/ROMs bouwen, de server en screenshot-/inputbediening
   starten. Hiermee schrijf je geen cartoplossing en lees je geen cartimplementatie.
2. **Afronding:** de door Studio opgeslagen diff beoordelen, bewijs/documentatie
   opslaan en een coherente slice committen. Gebruik die diff niet tussendoor als
   verborgen diagnosekanaal. Bewerk een gevonden bronprobleem weer in Studio.

## Benodigde omgeving en starten

Claude heeft een browserbediening nodig die echte keyboard-/pointerevents kan
versturen én screenshots kan bekijken. Een shell zonder visuele feedback is
onvoldoende. Headless Chromium is prima; headless betekent hier niet dat een
testharness de UI mag overslaan. Gebruik dezelfde browsersessie voor de proef.

Begin met `AGENTS.md`, deze overdracht en `git status --short --branch`.
Bewaar bestaande wijzigingen. Bouw alleen ontbrekende of verouderde producten,
zonder `--force`, clean, Docker-bootstrap of verwijderen van builddirectories:

```sh
cd /home/boaz/BMSX
npm run build:product:browser-studio -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- 2024 --debug
npm run build:toolchain:cart -- nemesis_s --debug
node scripts/serve-dist.mjs --dir dist --host 127.0.0.1 --port 8082
```

Poort 8082 is een voorbeeld: kies een vrije poort, beëindig geen onbekende
bestaande server. Start vanuit de repo; de server gebruikt zijn werkmap als
workspace-root. Open:

```text
http://127.0.0.1:8082/studio.debug.html?rom=2024.debug.rom
http://127.0.0.1:8082/studio.debug.html?rom=nemesis_s.debug.rom
```

De server biedt echte workspaceopslag: Save kan bestanden in deze checkout
wijzigen. Verwijder geen workspace-state om een test toevallig groen te krijgen.
Laat een aparte proefdirectory voor screenshots en actielog aanmaken, bijvoorbeeld
`.bmsx/authoring/claude-studio-only-2026-09-18/`; overschrijf oud bewijs niet.

Een lokaal voorbeeld van de eerdere inputadapter staat in
`.bmsx/authoring/2024-studio-only/ui.mjs`. Het is een genegeerd sessieartefact,
geen gegarandeerd meegeleverd of portable product. De Playwright-import verwijst
naar een machinegebonden npm-cache, de outputmap is vast en de teller begint op
300. Voer hem dus niet blind opnieuw uit. Gebruik beschikbare browsertools of
pas alleen de infrastructuur van zo'n adapter aan voor een nieuwe sessie.

De eerdere adapter accepteerde JSON-arrays via stdin met uitsluitend `goto`,
`press`, `down`, `up`, `type`, `click`, `move`, `wheel`, `resize`, `screenshot`.
Elke batch werd gelogd en gevolgd door een screenshot. Bijvoorbeeld:

```json
[{"op":"goto","url":"http://127.0.0.1:8082/studio.debug.html?rom=2024.debug.rom"}]
[{"op":"press","key":"ControlRight+ShiftRight"}]
[{"op":"screenshot"}]
```

Een alternatieve adapter mag hetzelfde publieke input-/pixelcontract uitvoeren;
voeg geen applicatie-evaluatie, clipboardroute of cartbestandtoegang toe. Gebruik
actuele screenshots voor coördinaten, geen vaste pixels uit de vorige sessie.

## Bediening

Dit is een startkaart, geen opdracht om blind sneltoetsen af te vuren. Controleer
focus, zichtbare toestand en commandobeschikbaarheid na iedere relevante actie.

| Handeling | Route |
| --- | --- |
| Studio openen/sluiten | Right Ctrl + Right Shift |
| Opdrachten vinden | Ctrl+Shift+P, binnen Studio |
| Resources zoeken | Ctrl+, of de zichtbare resourcepicker |
| Symbolen in bron zoeken | Ctrl+Shift+O |
| Projectcode ontdekken | Ctrl+klik op een symbool; completion met Ctrl+Space proberen; hovers bekijken |
| Opslaan / Undo / Redo | Ctrl+S / Ctrl+Z / Ctrl+Y |
| Hot Resume | Ctrl+Shift+S; lees eventuele bevestiging of buildfout |
| Bewust opnieuw booten | Ctrl+Shift+R of Run-menu |
| Gewone emulatiepauze | Run → Pause, één toggle |
| Debugger Continue / Step Over / Into / Out | F5 / F10 / F11 / Shift+F11, in debuggercontext |
| Frame vooruit / achteruit | F7 / Shift+F7, in de toepasselijke Studio/Game View-context |
| Visuele scènes / live objecten / scenario's | Scene Editor / Actor Lab / Scenario Lab via View of palette |
| Scenario debuggen | Kies expliciet Debug in Scenario Lab; F5 is daar Run |
| Foutinspectie beëindigen | Scenario Lab → Stop; dit herstelt canonieke media en boot opnieuw |

Studio openen is niet hetzelfde als emulatie pauzeren. Save is niet hetzelfde
als Hot Resume. Een gewijzigde scene-definitie verandert niet automatisch iedere
bestaande instance. Scenario Stop belooft geen herstel van de spelpositie van
vóór de test. F5/F6 zijn buiten Studio gewone mogelijke speltoetsen.

Gebruik voor korte bewegingsvergelijkingen frame-stepping met **zichtbaar spel**,
of rewind naar dezelfde situatie. Alleen de code-editor zien na een framestap is
geen bewijs van gameplay. Voor laden/compileren mag je op zichtbare gereedheid
wachten; los een ontbrekende inputtransitie niet op met steeds langere sleeps.

## Volgende stappen en acceptatie

### 1. Korte 2024-controle

Open via Studio de bestaande `tests/carts/2024/2024_navigation_assert.lua` en
Scenario Lab. Vind de test via de zichtbare resource-/scenariobediening; lees het
bestand niet met de shell. Voer Debug en Run uit en controleer de navigatie:
intro → vraag 1 → intro → vraag 1 → laatste vraag → conclusie → laatste vraag.

Gebruik een bronbreakpoint en hover om de bereikte toestand te inspecteren.
Een onverwachte mislukking moet via Details/stack naar de juiste bron leiden.
Controleer een succesvolle run opnieuw na page reload. Verzwak geen assertion
en voeg geen langere vaste vertraging toe om een fout te verbergen.

### 2. Werkelijke ontwikkelproef in Nemesis

Ontdek eerst via Studio hoe een bestaande vijand, zijn prefab, sceneplaatsing en
gedrag samenwerken. Leg minstens één geslaagde definitienavigatie en één
completion-/hoverpoging vast, inclusief wat deze wel of niet opleverden.

Maak vervolgens een kleine maar inhoudelijke uitbreiding: bijvoorbeeld een
nieuwe vijandvariant met herkenbare nadering, verticale richtingswisseling en
vertrek, plus een afzonderlijk bewerkbare plaatsing in de stage-scène. Kies de
concrete variant pas na brononderzoek in Studio. Gebruik de bestaande passende
gedragsvorm; een behavior tree is geen verplichte vorm. Een node die alle oude
AI aanroept of alleen een hernoemde bestaande vijand is geen showcase.

Voer minimaal deze ontwikkelcyclus uit:

1. Navigeer naar relevante definities; bepaal via zichtbare bron en tooling welke
   callbacks, parameters en eigenaars de wijziging nodig heeft.
2. Typ wijzigingen stapsgewijs in Studio; gebruik de gevonden API's en normale
   edit-/completionroutes. Maak eventuele bestanden via Studio aan.
3. Bewerk de plaatsing ook in Scene Editor. Controleer de overeenkomst met Lua,
   Undo/Redo en Save; er blijft één canonieke definitie.
4. Pas toe met Hot Resume op een bruikbare spelpositie. Inspecteer het gedrag
   met breakpoint/hover en in de zichtbare Game View met stepping of rewind.
5. Wijzig een tweede keer op basis van die observatie en pas opnieuw toe. Toon
   dat het nieuwe gedrag werkelijk verandert en welke bestaande state behouden
   blijft. Claim geen live instance-update wanneer alleen de definitie veranderde.
6. Speel door tot een nieuw object zijn assets moet laden. Test ook expliciet
   cold reboot en heropenen van opgeslagen bron. Alleen een bestaande sprite
   blijven zien is onvoldoende bewijs voor correcte bron-/assetinstallatie.
7. Voeg waar haalbaar via Studio een gerichte Scenario Lab-test toe en voer die
   daar uit. Een externe regressietest mag later aanvullend bestaan, maar telt
   niet als deze gebruikersproef.

### 3. Daarna pas verbreden

De scene-migraties zijn al geïmplementeerd; begin geen tweede migratie op basis
van oude inventarisaties. De volgende gebruikersproeven zijn een kleine
scene-/animatiewijziging in `2025`, daarna Pietious-kamerbewerking en herbetreding.
Controleer bij Pietious ook inventory/progressie, New Game versus room reload
en Enter/halo. Blijvende spelstatus hoort bij de sessie; een vertrekkende kamer
mag niet kunstmatig blijven leven om verzamelde items te onthouden.

De eerder uitgestelde brede LuaLS/VS Code-performanceherziening is geen onderdeel
van deze opdracht. Meet wel zichtbare completion-/navigatievertraging en noteer
de precieze gebruikershandeling als die de proef belemmert.

## Als Studio zelf tekortschiet

Bewaar eerst screenshot, exacte acties, zichtbare fout/stack en het verschil
tussen verwachting en resultaat. Onderzoek met de aanwezige Studio-tools en
probeer een onafhankelijke volgende proef wanneer dat zinvol is. Verberg het
probleem niet met runtime-injectie, een cart-specifieke uitzondering, een andere
host of stilzwijgende externe codebewerking.

Een noodzakelijke reparatie aan Studio/host/compiler buiten Studio is een
**afzonderlijke productreparatie**, geen geslaagde UI-only stap. Benoem die
scopewijziging expliciet; deze overdracht geeft geen vrijbrief om de beperking
ongemerkt los te laten. Lees vóór zo'n implementatie actuele relevante
productiecode op GitHub, zoals VS Code voor debugger/editor en Godot voor
scene-/resource-eigenaarschap. Volg `AGENTS.md` en `docs/architecture.md`;
repareer de eigenaar, zonder fallbacklagen of extra per-frame werk. Herhaal
vervolgens de oorspronkelijke gebruikershandeling om het herstel te bewijzen.

## Bewijs en oplevering

Houd een actielog bij met screenshotnummers en korte waarnemingen. Noteer per
wijziging waar de API-informatie in Studio is gevonden, wat Save/Apply deed,
welke debuggerinformatie beschikbaar was en wat zichtbaar in het spel veranderde.
Onderscheid expliciet: **UI-only bewezen**, **alleen automatisch getest**,
**nog niet bewezen**, **geblokkeerd door producttekort**.

Lever een kleine echte cartuitbreiding, de via Studio opgeslagen bestanden,
herhaalbare bedieningsstappen, screenshots en de resterende concrete UX-problemen
op. Bekijk pas daarna de Git-diff, controleer `git diff --check` en commit iedere
coherente gevalideerde slice zonder andere wijzigingen mee te nemen. Niet pushen
zonder opdracht. Wis geen bestaand bewijs of gebruikersdata.

## Achtergrond en eerder bewijs

- [Scenario-debugging en recente regressies](scenario_debugging.md): gepinde
  productievoorbeelden, oorzaak en validatie van de recente reparaties.
- [Studio-workflows](studio_development_workflows.md): W01–W09 en hun grenzen;
  oudere statusregels zijn geen actuele feature-inventarisatie.
- [Scenelevensduur](scene_lifetimes.md) en
  [cartmigraties](cart_scene_migration.md): eigenaarschap en migratieachtergrond.
- Lokaal, niet gegarandeerd beschikbaar in een andere checkout:
  `.bmsx/authoring/2024-studio-only/actions.jsonl`, de bijbehorende `ui-*.png`
  en `ui-449.png` voor de succesvolle run na reload.
- `.bmsx/authoring/studio-w03/`: **geautomatiseerde** regressielogs en captures.
  `workflows-directory-after.log`, `nemesis-directory-after.log` en
  `scenario-directory-after.log` bevatten de laatste drie-rendererresultaten.

Gebruik deze overdracht voor context en bediening. De oplossing voor de nieuwe
cartuitbreiding moet je in Studio ontdekken en ontwikkelen.
