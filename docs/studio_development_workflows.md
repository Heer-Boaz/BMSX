# Studio: ontwikkelworkflows en acceptatiegrenzen

Status: **W01-W03 geïmplementeerd en gecombineerd getest**. W04-W09 blijven
ontwerp- en verificatiegrenzen, niet een claim dat de volledige Studio af is.
Gecontroleerd op 2026-09-06; oorspronkelijke inventarisatie op `7ffd43824`,
falende browser-Studio-proef vóór de implementatie op `9cb4cf93b`.

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
| [MAME machine lifecycle](https://github.com/mamedev/mame/blob/master/src/emu/machine.cpp) | Pauze is uitvoeringsbeleid; postload-notificaties herstellen afgeleide observaties buiten de geserialiseerde devices. | Geen Studio-state in een machine snapshot of extra controle per guest-instructie. |
| [VS Code debug commands](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugCommands.ts) en [debug task runner](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugTaskRunner.ts) | Pause/Continue/Step gebruiken de uitvoeringsowner en command-context. Een afgewezen bronbuild is niet hetzelfde als een fout in de draaiende uitvoering. | Geen Run Anyway-route, fake guest-stack voor compilerdiagnostiek of tweede debug-runtime. |
| [Roslyn DebugInfoInjector](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Lowering/Instrumentation/DebugInfoInjector.cs) | De compiler publiceert ook verborgen sequence points voor gegenereerde code en EnC-remapgrenzen. | Geen ontbrekende compilerinformatie raden in de Hot Resume-consumer. |

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

## Huidige owners en resterende grenzen

| Onderdeel | Live owner / waarneming | Vervolg vóór een bredere claim |
| --- | --- | --- |
| Host-pauze en rewind | `HostExecutionControl` in `hosts/common/execution_control.ts` bezit pauzeredenen en expliciete uitvoeringsopdrachten; `HostRewind` bezit review/seek. `HostFrameSession` bezit alleen de frame-timing en verwijzingen naar die services. | W01-W03 gebruiken dezelfde geïnjecteerde owners; geen DOM-only pause-controller of feature die de hele host-framecompositie importeert. |
| Rewind verlaten | `HostOverlayMenu.transitionTo`: Accept → `resumeHere`, Cancel → `returnToPresent`, Retain → `pauseSeek`, Discard → geen nieuwe history-opdracht. | `CartEditor.onDidChangeActive` wordt in de productcompositie gekoppeld aan Retain. Een view kiezen branch't niet; Continue en een aanvaarde code-installatie zijn expliciete andere opdrachten. |
| Inspectie na restore | `Runtime.onStateRestored` meldt voltooide restore aan de debugger-/fault-/sourceowners. | Oude frames, hover/cache en foutcontext verdwijnen; breakpointdefinities blijven en hun PCs worden opnieuw gebonden. Herstelde tabellen worden opnieuw gelezen via de bestaande guest-representatie. |
| Hot Resume/FSM | `ide/runtime/hot_resume.ts` plant completion calls; `cartlib/fsm/library.lua` registreert en rebindt levende machines. | De browserproef verandert een echte FSM-regel en behoudt de actor. Geen aparte FSM-Hot-Resume-route of stille state-reset. Zie hieronder voor de afzonderlijke plicht onterechte weigeringen op te lossen. |
| Historie na apply | De queue serialiseert; de werkelijk muterende media-/init-owner stopt historie. Bronbuild en relocatie gaan vooraf aan installatie. | Geen historie over oude en nieuwe code mengen. Supervisor-return en `<init>` zijn toolgestuurde uitvoering, niet gewone opgenomen ICU-input. Pas na afloop begint een nieuwe geschiedenis op de behouden positie. |
| Scenario Lab | `ScenarioRunService.restoreCanonicalMedia` in `ide/workbench/contrib/scenario_lab/run_service.ts` installeert de canonieke ROM en boot opnieuw. | Dat herstelt **media**, niet de vooraf gepauzeerde speltoestand. De UX moet dit onderscheid tonen. Exact terugkeren na een run vraagt apart behoud-/geheugenbeleid; dat is hier niet ontworpen of beloofd. |
| Scene-authoring | `ide/workbench/contrib/scene_editor/source.ts` projecteert geregistreerde Lua-definities. De scene- en documentgrenzen staan in de bestaande ontwerpen. | W05 eerst toetsen aan een concrete cart en echte runtimeoperatie; geen instantiesynchronisatie raden uit bronvelden. |

Een debuggerstap, PCRTC-grens en cartlib-`worldtick` zijn niet uitwisselbaar.
De generieke rewindhistorie werkt met machinecycli/PCRTC-inputgrenzen. Een
toekomstige Studio-knop voor één worldtick moet de echte cartlib-grens volgen;
zij mag niet toevallig één host-renderframe uitvoeren en dat een worldtick noemen.

## W01-W03 als complete ontwikkellus

### Uitvoeringscontract en representaties vóór de implementatiediff

De browser-Studio-proef op `9cb4cf93b` bereikt met echte BIOS/Nemesis-ROMs en
WebGPU de tijdlijn en faalt op het onafhankelijk vasthouden via host-pauze.
De proef gebruikt `prepareWorkbenchRuntime` en `runWorkbenchHostFrame`.

| Opdracht / overgang | Owner en effect |
| --- | --- |
| Pause | Het command stopt een lopende seek op de bereikte positie en zet `HostExecutionControl.Requested`; de audio-owner dempt de uitvoer. Geen guest-instructie of history-branch. |
| Fullscreen / vibratie-initialisatie | Eigen pauzeredenen. Afronden kan de gebruikersreden niet wissen. |
| IDE openen | De host-menunavigatie verlaat de modal met Retain, niet Accept/Cancel. Editorfocus verandert geen tijdpositie en branch't de historie niet. |
| Continue | Expliciet de reviewpositie overnemen, gebruikerspauze opheffen en zo nodig de debugger laten doorgaan. Andere pauzeredenen blijven gelden. |
| Debuggerstap | Bestaande source-stepper mag uitvoeren onder gebruikerspauze; fullscreen/initialisatie blijven blokkeren. Na de stap blijft de gebruikerspauze staan. Geen worldtick claim. |
| Hot Resume | Bestaande bronbuild/relocatie, vervolgens installatie/`<init>`. De muterende owner verbreekt historie, niet de wachtrij vóór de build. Alleen een geaccepteerde opdracht heft gebruikerspauze op. |
| Restore | De Runtime publiceert een post-restore-notificatie buiten de machine-/CPU-hot-path. Tooling vervangt de stop/inspectiecontext; machine snapshots bevatten geen debugger- of UI-state. |

Pause (F6) en Continue (F5) zijn gewone geregistreerde opdrachten in het
Run-menu, met dezelfde enabled/checked-context en keyboard-dispatch buiten de
editor. Source Step blijft de bestaande debuggeropdracht. De eerste werkelijke
uitvoering na Continue/Step verbruikt de wandtijd-reset; een opdracht na de
frame-invoer mag niet alsnog de oude pauzeduur aan de scheduler geven.

Broncode gelezen: MAME `running_machine::pause/resume/toggle_pause` en
postload-notifiers; VS Code `debugCommands.ts` (pause/continue/source-steps
via debug-owner en command-context); Unity `PlayModeButtons.cs` (pause-state
bij `EditorApplication`, toolbar uitsluitend projectie). Dit zijn de
ownershipvoorbeelden, niet een te kopiëren editor- of emulatormodel.

| Gedeelde representatie | TypeScript | C++ | Aanroepgrens |
| --- | --- | --- | --- |
| Restore-notificatie | `Runtime.onStateRestored: (() => void) \u007c null` | `Runtime::onStateRestored: std::function<void()>` | Eén keer aan het einde van `applyRuntimeSaveState`; niet geserialiseerd, geen per-frame/CPU-callsite. |
| Modal verlaten zonder tijdkeuze | `HostOverlayOutcome.Retain`, `HostOverlayMenu.dismiss` | Gelijknamige enumwaarde/methode | Externe viewnavigatie; `transitionTo` gebruikt dezelfde `HostRewind.pauseSeek` als expliciet seek stoppen. |
| Rewindrequest en positie | Bestaande `RewindRequest`, cycli als gehele `number` | Bestaande `RewindRequest`, `i64` | `HostRewind.service`, `seekTo`, `pauseSeek`, `resumeHere` blijven dezelfde algoritmen. |
| Gebruikerspauze | `HostExecutionControl`, afzonderlijke bits voor Requested/Fullscreen/VibrationInitialization | Libretro-frontend bezit gewone host-pauze door geen `retro_run` aan te roepen; geen Studio-commandlaag in de core | TS `prepareHostUpdate`, player/workbench/profiling-loop. Expliciete stappen komen uitsluitend uit de bestaande tooling-stepper. |

Aanvullend aangetoond door de gecombineerde proef: de compilergegenereerde
IRQ-/exception-return had geen resume-punt wanneer mechanische relinking
haar functiebytes wijzigde. `CPU.lastPc` kan juist die `RFE` bevatten. De
producer (`FunctionBuilder.compileInterruptEntry/compileExceptionEntry`) publiceert
een verborgen resume-punt aan het module-einde, via bestaande liveness- en
source-revisiemetadata. Geen statement-breakpoint, extra opcode, CPU-edit of
special-case in de relocatieconsumer. Tooling-only; C++ ontvangt dezelfde
ongewijzigde instructies. Voorbeeld: Roslyn `DebugInfoInjector` publiceert ook
sequence points voor gegenereerde code en EnC-remapgrenzen.

Geraakte hot-path callsites: `runHostFrame`, `runWorkbenchHostFrame`,
`runCpuProfileHostFrame`, `runHeadlessScenarioFrame` (ongepacede logical ticks),
`prepareHostUpdate`, `presentPausedFrame`, `HostRewind.service` en native
`runLibretroFrame`. Restore en code-installatie zijn koude grenzen. De
guest-uitvoering krijgt geen extra allocaties, epochcontrole of inspectiechecks.

De queue bezit GPU-callbackvolgorde, niet de beslissing of bron kan worden
toegepast. `actions.ts` bereidt de vastgelegde textmodelversies voor en bouwt
binnen die exclusieve taak. Compileerdiagnostiek blijft bron-/taakdiagnostiek;
zij verzint geen guest-stack en vergrendelt Continue niet. De gebouwde revisie
behoudt de expliciet gewijzigde execution domains, los van mechanisch
meegerelinkte media. Pas de installatiestap markeert die bronversies toegepast.

Een apply-fout na aanvaarde supervisor-return is niet gelijk aan een
compileerfout vóór uitvoering: de BIOS kan al hebben uitgepakt. De huidige
operationele foutstop blijft bestaan; er is geen state-rollback of Run Anyway.
Een fout tijdens de nieuwe `<init>` is een echte guest-fout. Reparatie volgt de
bestaande supervisor-return/completion-call-route, behoudt de actor en wist de
oude inspectie en foutadornments pas bij de volgende geslaagde installatie.

Dat werkpakket is niet tegelijk een worldtick-stepper, sceneviewport,
live-instance-inspector of uitbreiding van Scenario Lab. W04-W09 blijven wel
zichtbare aansluitvoorwaarden; als de eerste slice hun owners raakt, worden
hun relevante overgangen in dezelfde slice getest.

### Geen onterechte Hot Resume-weigeringen

Normale edits moeten kunnen worden toegepast. Een ontbrekende mapping is geen
bewijs dat de edit inhoudelijk onmogelijk is: de gegenereerde `RFE` hierboven
was een producerbug. Checks blijven verplicht, maar ontbrekende toolingmetadata
wordt aan de producer opgelost, niet met een gok-PC of een fallback genegeerd.

Een echte bronfout kan niet worden geïnstalleerd. Een verdwenen actieve
uitvoering zonder eenduidige voortzetting vraagt een inhoudelijke beslissing,
geen verborgen reboot. De huidige eisen aan captured-upvalue-, static-storage-
en `<init>`-slotlayout zijn daarentegen beperkingen van de bestaande
implementatie: de bewaarde closures en opslag hebben nog geen migratiecontract.
Die checks bewijzen niet dat zo'n migratie principieel onmogelijk is. Dit
werkpakket levert daarvoor geen migratie, en de geslaagde workflows bewijzen
niet dat iedere andere Lua-edit al kan worden toegepast.

### Gecombineerd uitvoeringsbewijs

`npm run test:studio-workflows` bouwt echte BIOS/Nemesis-ROMs en draait
`tests/conformance/runtime_replay/browser_studio.ts` via de productcompositie
`prepareWorkbenchRuntime` / `runWorkbenchHostFrame`, met software, WebGL2 en
WebGPU in afzonderlijke Chromium-sessies.
`BMSX_PLAYWRIGHT_MODULE` kan naar een lokale Playwright-module wijzen; de
bijbehorende Chromium-installatie is vereist. De runner gebruikt de echte
`serve-dist.mjs` workspace-API op een tijdelijke kopie van de Lua-sources.
Geen testcart, world-proxy, heapvervangende fixture of schrijfpad naar de
werkelijke workspace. Tijd, fysieke input en de host-audiosink zijn beheerst.

De algemene ontwikkellus heeft **geen WebGPU-vereiste**. Dezelfde proef wordt
uitgevoerd met de software-, WebGL2- en WebGPU-backend, ieder met een eigen
workspace en browsersessie. `studio_fixture.ts` bouwt de echte workbench rond
de meegegeven `GPUBackend`; `studio_workflows.ts` kent geen concrete backendvelden.
Dit volgt het principe van [Playwright projects](https://github.com/microsoft/playwright/blob/main/docs/src/test-projects-js.md):
dezelfde tests onder verschillende configuraties, geen afwijkende workflow per
renderer. De softwareproef toont voor de screenshot de echte gepresenteerde
framebuffer; zij vervangt geen rasterisatie of overlaytekening.

Alleen `studio_webgpu_readbacks.ts`, de aanvullende `mapAsync`-callbackproef,
ontvangt een `WebGPUBackend` en draait bij die configuratie. Deze extra
capability-eis staat los van W01-W03: software en WebGL2
hebben die asynchrone WebGPU-API niet nodig. De browserowner deelt concrete
device-/canvasaanmaak tussen product en tests; de gewone browser kiest op
externe beschikbaarheid. Geen backend-cast, `instanceof`-afkeuring, tweede
adapteraanvraag of test-only renderer. Het onderscheid tussen selectie en
concrete aanmaak sluit aan op [Three.js renderer/backend ownership](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/WebGPURenderer.js)
en de expliciete devicevoorziening van de [WebGPU CTS](https://github.com/gpuweb/cts/blob/main/src/webgpu/gpu_test.ts).

De drie backendconfiguraties slagen met dezelfde machineposities bij de
gecontroleerde stop-/applyovergangen. De tiny-fontscreenshots van alle drie
zijn geïnspecteerd. De proef bewijst:

- Pauze zonder rewind; onafhankelijke fullscreen-/initialisatie-redenen;
  Continue zonder wandtijd-inhaalslag en source-step onder gebruikerspauze.
- Tijdlijn → vasthouden → IDE → echte FSM-regel wijzigen → Hot Resume;
  dezelfde actor, veranderde inputrespons, meerdere opeenvolgende revisies.
- Breakpoint → inspectie → rewind → opnieuw inspecteren; bronbreakpoints
  blijven terwijl guest-table-identiteit en de hover/stack-context vervangen worden.
- Compileerfout vóór installatie: dezelfde cycles, media en historie; de
  editor blijft op de gewijzigde bron en Continue blijft bruikbaar.
- Breakpoint en source-step binnen `<init>`; geen replayregistratie van de
  toolgestuurde init; nieuwe historie pas na het einde van die uitvoering.
- Herhaalde seek-/editopdrachten tijdens een werkelijk uitgestelde WebGPU
  `mapAsync`: geen CPU/mediawijziging vóór de callbackgrens, geen oude seek die
  na de aanvaarde installatie alsnog wint.
- Een echte guest-init-fout, zichtbare stack, herstel via de BIOS-route met
  dezelfde actor en zonder oude foutadornments na installatie.
- Pointerbediening van het echte Run-menu, command-context en tiny-fontbeeld.

De compiler/linker-regressie controleert de verborgen vector-returnpunten en
afwezigheid van fictieve statement-breakpoints. De echte Hot Resume-harness en
Scenario Lab blijven afzonderlijke regressies; cross-core runtime/history-,
native host- en libretro-ABI-proeven bewijzen de gedeelde niet-IDE-grenzen.

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

De eerdere individuele regressieresultaten staan in
[rewind_architecture.md](rewind_architecture.md). De nieuwe gecombineerde proef
is aanvullend browser-Studio-bewijs, geen fysieke SNES Mini-meting, volledige
Studio-acceptatie of bewijs van worldtick-stepping.
