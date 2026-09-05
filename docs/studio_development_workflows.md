# Studio: ontwikkelworkflows en acceptatiegrenzen

Status: **ontwerp en live-ownerinventarisatie, geen implementatiebewijs**.
Gecontroleerd op 2026-09-06, checkout `7ffd43824`.

Dit document verbindt de bestaande functies uit
[het functionele ontwerp](studio_functional_design.md) tot ontwikkelwerk.
De gebruiker hoeft niet alle editorcombinaties vooraf te specificeren. Codex
moet normale workflows uit productievoorbeelden afleiden, verschillen met BMSX
benoemen en de relevante overgangen bewijzen vóór oplevering. De inventaris is
uitbreidbaar; zij is geen claim dat alle mogelijke gebruikssituaties bekend zijn.

## Uitgangspunt

Het doel is gedrag kunnen maken, begrijpen, wijzigen en opnieuw proberen.
Niet een UE5-uiterlijk boven losse functies, en niet vooraf een generieke
Studio-manager ontwerpen. Een workflow mag meerdere bestaande owners raken;
een verkeerde owner wordt eerst herzien, niet met een speciale route omzeild.

Host-pauze stopt gewone emulatie-uitvoering. UI, presentatie en expliciete
seek-/debuggeropdrachten blijven beschikbaar. Rewind kiest een machinepositie;
het is geen noodzakelijke pauzemodus. De IDE openen of sluiten is op zichzelf
geen opdracht om terug te keren naar het heden of gameplay te hervatten.
Een expliciete Hot Resume-opdracht behoudt de bereikte toestand, past code toe
via de bestaande tooling-/`<init>`-route en hervat de uitvoering. Alleen typen,
opslaan of een venster wisselen is die opdracht niet.

Dit is hostbeleid, geen pause-MMIO, Studio-flag in de CPU of cartlib-hook.
De game-eigen gameplay-clock en de BIOS-monitor zijn andere mechanismen.

## Bekeken professionele voorbeelden

| Referentie | Relevant productgedrag / ownership | Niet automatisch overnemen |
| --- | --- | --- |
| [Unreal in-editor testing](https://dev.epicgames.com/documentation/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine?lang=en-US) | Spelen, inspecteren, pauzeren en input teruggeven aan de editor zijn herkenbare handelingen. De documentatie maakt ook duidelijk welke veranderingen tijdens testen mogelijk zijn. | PIE dupliceert het level. BMSX krijgt hierdoor geen tweede Machine, schaduwwereld of impliciete terugzetactie bij Stop. |
| [Unity Game view](https://docs.unity3d.com/6000.0/Documentation/Manual/GameView.html) en [PlayModeButtons](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/PlayModeEditor/Managed/Scenarios/UI/Toolbar/PlayModeButtons.cs) | De toolbar toont uitvoeringsstatus en stuurt pause/step naar de uitvoeringsowner. Viewfocus en uitvoeringsbediening zijn verschillende zaken. | Unity's frame-eenheid en scenarioframework zijn niet het BMSX-machine- of worldtickcontract. |
| [Godot debug tools](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/overview_of_debugging_tools.html) en [EditorDebuggerNode](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_node.cpp) | Authored content en de concrete draaiende instance zijn herkenbaar verschillend. Inspectie hoort bij een bepaalde debugsessie; live-editopdrachten en ontvangen observaties hebben eigen routes. | Geen Godot-nodeprotocol, host scene graph of generieke heap-DTO in BMSX. |
| [VS Code custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors) | Meerdere views delen het document, bewerkingen en undo. Een gesloten view is geen vernietigd document. De reeds gepinde bronowners staan in [ide/ARCHITECTURE.md](../ide/ARCHITECTURE.md). | Geen tweede authored FSM/BT/scene-formaat naast de canonieke Lua-bron. |
| [VS Code Testing API](https://code.visualstudio.com/api/extension-guides/testing) | Tests ontdekken, een scope uitvoeren, annuleren en resultaten bekijken zijn afzonderlijke handelingen. | Een testuitkomst bekijken is geen opdracht om opnieuw te booten; geen extra runtime om onuitgewerkt sessiebeleid te verbergen. |

De volgende workflows zijn **BMSX-afleidingen** uit die voorbeelden en de
gebruikersdoelen, geen bewering dat iedere referentie dezelfde rewind- of
Hot Resume-semantiek implementeert.

## Workflowcatalogus

| ID | Normaal ontwikkelwerk | Wat aantoonbaar moet kloppen |
| --- | --- | --- |
| W01 | Spelen → pauzeren → IDE/inspectie → hervatten; ook zonder rewind | Geen autonome emulatiecycli tijdens pauze; geen inputlek, oude audiobuffer of wandtijd-inhaalslag. De geopende view bepaalt niet waarvandaan wordt hervat. |
| W02 | Terugzoeken → gekozen toestand vasthouden → Lua/FSM aanpassen → Hot Resume → opnieuw proberen | Geen tussenstap naar het oude heden of cold boot. De nieuwe code draait op de behouden toestand. Opnieuw uitvoeren en opnieuw wijzigen werken ook bij een tweede en derde iteratie. |
| W03 | Breakpoint/fault → stack en waarden bekijken → naar bron → wijzigen of stappen → verder | Bronlocaties, geselecteerde frames en guest-values horen bij de huidige stop en geïnstalleerde code. Een restore of hervatting mag geen oude inspectiereferenties opnieuw als actueel presenteren. |
| W04 | Tekst- en visuele editor afwisselen → undo/redo → opslaan → toepassen | Eén bronmodel; onderscheid tussen gewijzigde, opgeslagen en werkelijk toegepaste code. Source-undo draait geen emulatietijd terug en maakt een uitgevoerde Hot Resume niet ongedaan. |
| W05 | Scene/prefab/gedrag selecteren → eigenschap wijzigen → effect op een concrete actor beoordelen | Duidelijk of de wijziging de definitie, de levende instance of beide raakt. Een gewijzigde scene-definitie is niet automatisch toegepast op reeds bestaande objecten. Tijdelijke runtime-edits zijn niet stilzwijgend opgeslagen bronwijzigingen. |
| W06 | Eén scenario of categorie testen → annuleren of afronden → resultaat bekijken → verder ontwikkelen | Testscope, voortgang en terminale uitkomst blijven coherent. Het is vooraf zichtbaar of de testrun de huidige uitvoering vervangt; resultaatnavigatie start geen nieuwe run. |
| W07 | Gamepad/muis loslaten → editor/terminal/menu wisselen → terug naar game; resize/fullscreen/font wisselen | Focuswisseling verzint geen button-press, verandert geen gekozen tijdpositie en heft geen onafhankelijke pauzereden op. Commandbereikbaarheid, hitgebieden en leesbaarheid kloppen op de werkelijke lage resolutie. |
| W08 | Seek of codebuild loopt nog → nieuwe opdracht, annulering of fout → verder werken | De laatste geaccepteerde opdracht en de zichtbare toestand kloppen met elkaar. Geen verborgen reboot, stale resultaten of herstel-fallback. Een compileerfout vóór installatie wijzigt de machine niet; een fout tijdens guest-`<init>` is een zichtbare uitvoeringsfout, geen verzwegen succes. |
| W09 | Bewust opnieuw starten of andere media laden → oude tabs/resultaten/inspectie gebruiken | Documenten kunnen behouden blijven, maar oude live inspectie is niet meer de nieuwe uitvoering. Herstarten is geen synoniem voor hervatten en gebeurt niet als gemaksmiddel bij een edit die niet live kan worden toegepast. |

## Concrete gaten en grenzen in de huidige owners

| Onderdeel | Live owner / waarneming | Vervolg vóór een bredere claim |
| --- | --- | --- |
| Host-pauze en rewind | `HostFrameSession` in `hosts/common/host_frame.ts` bezit pauzeredenen; `hosts/common/rewind.ts` bezit daarnaast review/seek-bediening. `ide/workbench/host_frame.ts` bedient rewind vóór de editorblokkade. | Eén expliciet uitvoeringscontract voor W01-W03. Een losse pauzeknop maakt die routes nog niet coherent. |
| Rewind verlaten | `HostOverlayMenu.transitionTo` kent voor de rewindpagina Accept → `resumeHere` en Cancel → `returnToPresent`. | Een gekozen toestand vasthouden en naar bewerken gaan mag niet worden vertaald naar Accept-plus-opnieuw-pauzeren of Cancel-plus-terugzoeken. |
| Inspectie na restore | `ide/runtime/suspended_guest.ts`, `debugger_state.ts`, `debugger_plans.ts` en de breakpoint-/sourceowners | Levensduur van waarden, frames en bronrelaties expliciet toetsen bij restore, apply en hervatten. Dit is een open verificatiepunt, niet reeds een bewezen bug. |
| Hot Resume/FSM | `ide/runtime/hot_resume.ts` plant completion calls; `cartlib/fsm/library.lua` registreert en rebindt levende machines volgens het bestaande ondersteunde rebindcontract. | Gebruik dat mechanisme voor W02. Geen aparte FSM-Hot-Resume-route, stille state-reset of belofte dat elke structurele wijziging live kan. |
| Historie na apply | `RuntimeTaskQueue` stopt de huidige historie vóór een mutatie; snapshots en replay behoren bij de geïnstalleerde uitvoering. | Bij daadwerkelijk toepassen begint de huidige route een nieuwe geschiedenis op de behouden positie. Oude historie over meerdere codeversies bewaren is afzonderlijk ontwerp, niet impliciet onderdeel van W02. |
| Scenario Lab | `ScenarioRunService.restoreCanonicalMedia` in `ide/workbench/contrib/scenario_lab/run_service.ts` installeert de canonieke ROM en boot opnieuw. | Dat herstelt **media**, niet de vooraf gepauzeerde speltoestand. De UX moet dit onderscheid tonen. Exact terugkeren na een run vraagt apart behoud-/geheugenbeleid; dat is hier niet ontworpen of beloofd. |
| Scene-authoring | `ide/workbench/contrib/scene_editor/source.ts` projecteert geregistreerde Lua-definities. De scene- en documentgrenzen staan in de bestaande ontwerpen. | W05 eerst toetsen aan een concrete cart en echte runtimeoperatie; geen instantiesynchronisatie raden uit bronvelden. |

Een debuggerstap, PCRTC-grens en cartlib-`worldtick` zijn niet uitwisselbaar.
De generieke rewindhistorie werkt met machinecycli/PCRTC-inputgrenzen. Een
toekomstige Studio-knop voor één worldtick moet de echte cartlib-grens volgen;
zij mag niet toevallig één host-renderframe uitvoeren en dat een worldtick noemen.

## Eerstvolgende werkpakket: W01-W03 als complete ontwikkellus

1. Leg de opdrachten en hun overgangen vast bij de bestaande host-, history-
   en toolingowners: pauze, seek, vasthouden, expliciet annuleren, hervatten,
   Hot Resume en debuggerstappen. Maak pending-uitkomsten en de eigenaar van
   iedere pauzereden expliciet. Geen nieuwe algemene facade vooraf.
2. Verifieer het ontwerp tegen de native host/historyspiegels. Pauze blijft
   hostbeleid; Studio-UI/tooling hoeft niet naar libretro, maar de generieke
   uitvoering en historie krijgen geen afwijkende machinebetekenis.
3. Bouw vóór de wijziging een falende integratieproef voor W02 in de **echte
   browser-Studio/workbench-loop**, niet alleen `runHostFrame` van de player.
   Gebruik een echte cart, wijzig een daadwerkelijk uitgevoerde FSM-regel en
   bewijs zowel behouden toestand als veranderd vervolggedrag.
4. Breid dezelfde proef uit met W01/W03 en relevante W07/W08-overgangen:
   snelle herhaalde opdrachten, held input, wisselen tijdens GPU-readback,
   compileerfout en een stop in `<init>`. Test de omgekeerde volgorde waar die
   betekenis heeft, bijvoorbeeld eerst een breakpoint en daarna rewind.
5. Pas de owning grenzen aan en bewijs de uiteindelijke commanduitkomst,
   machinepositie, sourceversie, inspectie, audio en zichtbare bediening. Een
   typecheck of een groene lijst met losse onderdelen sluit deze gate niet.

Dat werkpakket is niet tegelijk een worldtick-stepper, sceneviewport,
live-instance-inspector of uitbreiding van Scenario Lab. W04-W09 blijven wel
zichtbare aansluitvoorwaarden; als de eerste slice hun owners raakt, worden
hun relevante overgangen in dezelfde slice getest.

## Opleveren zonder de gebruiker als eerste integratietest te gebruiken

Per workflow wordt bijgehouden: afgesproken gedrag, bronvoorbeeld, echte
owner(s), bewijs en ontbrekende ondersteuning. Tests variëren volgorde,
herhaling en pending-operaties rondom dezelfde ownerovergangen; geen eindeloze
cartesiaanse matrix en geen aparte implementatie per gebruikersverhaal.

De uiteindelijke gebruiksproef loopt op echte carts en de product-UI met
fault-gated screenshots. Browser-Studio, player/native en fysieke doelhardware
zijn afzonderlijke bewijsniveaus. Performanceclaims vereisen metingen;
compilebewijs, QEMU of een grens aan snapshot-aantallen bewijst geen fysieke
SNES Mini-geheugenruimte of responsiviteit.

Deze inventarisatie heeft geen nieuwe tests uitgevoerd en verandert geen
runtimegedrag. De eerdere individuele regressieresultaten blijven staan in
[rewind_architecture.md](rewind_architecture.md); zij zijn niet opgewaardeerd
tot bewijs voor de bovenstaande gecombineerde workflows.
