# ActionEffect: geselecteerde instance en geladen definitie

Datum: 2026-09-13. D2-vervolg op `2df0a5162`.

## Referenties en afleiding

- [LimboAI debugger][limbo] scheidt instancekeuze, getrackte instance en
  auteursbron; `_track_tree`/`_untrack_tree` bezitten de geselecteerde lifetime.
  BMSX gebruikt zijn **bestaande** cartlib-type-index, geen extra debugregister
  of LimboAI's doorlopende boomserialisatie.
- [VS Code VariablesView][variables] leest geselecteerde scopes en behoudt
  de projectie tot de debuggercontext verandert. BMSX leest alleen tijdens
  selectie; tekenen en scrollen lezen geen guesttabellen.
- [Qt Creator NodeInstanceView][qt] onderscheidt `valuesChanged` van
  `valuesModified`: waarnemen is geen auteurstransactie. Geladen BMSX-waarden
  krijgen geen automatisch afgeleide Lua-schrijfplek.
- [MAME debug_disasm_buffer][mame] leest via de betreffende device-adresruimte
  en `translate(..., TR_FETCH, ...)`, niet door alle ROMs op een numeriek
  adres te doorzoeken. BMSX gebruikt zijn bestaande instruction-busmapping.
- [VS Code StackFrame.openInEditor][stack] retourneert de asynchrone
  editoropening. Een debuggerstop mag zijn markering pas na die opening op
  de gekoppelde code-editor zetten.

Dit zijn toegepaste ownershipprincipes, geen gekopieerd engineprotocol.

## Afgebakend productcontract

`Live` in de ActionEffect-lens opent de gedeelde QuickInput-kiezer met werkelijk
toegekende effecten, hun owner-id en componentidentiteit. Selectie toont
instancevelden en de tabel waarnaar
`effect.definition` **nu** wijst in de bestaande property inspector. Dezelfde
id in geschreven registraties bewijst geen koppeling aan die geladen tabel.

De bronnencatalogus, visuele bronbewerkingen, Undo, Save en Hot Resume blijven
ongewijzigd. Deze slice biedt geen catalogus van geregistreerde maar nog niet
toegekende definities, algemene actorselectie, definitie-allocationherkomst,
runtime-mutatie of BT-topologieopname.

## Owners en representatie vóór de gespiegelde wijziging

| Gegeven | TypeScript | C++ | Toegang / verandering |
| --- | --- | --- | --- |
| CPU execution-busselectie | `executionBusSignals: MappedBusSignals` (`number`) | `m_executionBusSignals: MappedBusSignals` (`u8`) | Dezelfde nieuwe `readExecutionBusSignals()` leest het bestaande latch. Geen nieuwe state. |
| Closurefunctie | `Closure.functionAddress` | `Closure::functionAddress` | Bestaand rauw fysiek functieadres. Geen socket-id op closures. |
| Adresruimte | `ExecutionAddressSpace.domainIdOnBus(address, signals)` | Dezelfde methode, `std::optional<ExecutionDomainId>` | Bestaande mapping bepaalt system/slot0/slot1; gewone RAM heeft geen linked-ROM-bron. |
| Tabelwaarden | `ValueTag`, `Table`, `materializeValue` | Bestaande `Value`/`Table`-representatie | Alleen de IDE-reader wordt uitgebreid; geen DTO of gastvalidatie. |

Hot-path callsites blijven ongewijzigd: `CPU.latchActiveExecutionImage`
(`executionBusSignalsForDomain`), `decodedPageForFrame`, `decodeInstruction`,
`executeInstruction` (CLOSURE), `pushFrame`/`pushFrameFromCaller` (in C++ de
twee `pushFrame`-overloads) en `readFunctionRecordOnBus`. Ook `restoreRuntimeState` houdt
zijn bestaande latch-/frameherstel. Alleen de koude IDE-bronlookup en tests
gebruiken de accessor. C++ krijgt geen Studio, callbackreflectie of
nieuwe dispatchbranch. De bestaande C++-veldnaam wordt niet naar TS gekopieerd.

## Lezen en levensduur

- `readRuntimeLuaModuleExport` consumeert de compiler-owned exportslotnaam en
  de geïnstalleerde global-registerfilemetadata. Een slot dat nog nil bevat
  bewijst niet dat de moduleinitialisatie is uitgevoerd.
- De contribution leest `registry._entries_by_key[component_class].items` en
  per component de werkelijk opgeslagen `effects`-entries. Geen heap-/worldscan.
  De ordinary global-registerfile is gedeeld; een source-domain maakt geen
  tweede heap of slotgebonden componentidentiteit.
- Alleen de kiezer leent echte component-/effecttabellen. De inspector bewaart
  geformatteerde waarden en exacte navigatiemetadata, geen gekopieerde definitie
  of langlevende guestreferenties. Lezen voert geen callbacks of getters uit.
- `SuspendedGuestSession` beëindigt UI-readlifetimes vóór een expliciete guestcall
  en editor-deactivation. De bestaande `RuntimeIdeState`-restorecallback doet
  hetzelfde wanneer restore de heap vervangt. Geen per-feature epoch of CPU-hook.
- Een echte callbackclosure heeft een fysiek functieadres, geen geboortesocket.
  Zijn **huidige call-target** volgt de CPU execution-busselectie. In cartridge-
  uitvoering blijft deze selectie onafhankelijk van `CART_SELECT`; alleen
  system-EXEC gebruikt de gewone CPU-bussignalen. Het betreden van een BIOS-
  exceptionframe vervangt die latch niet. De lookup kiest uitsluitend
  symbolen uit die mapping. Geen eerste-ROM-wint of bronkoppeling op effect-id.
- Source is alleen beschikbaar wanneer de huidige working-copybytes exact
  overeenkomen met de geïnstalleerde callbackbron. Een scalarwaarde bewijst
  geen registratie-/allocationbron of grafische schrijfplek. Dynamische
  RAM-functies zonder linked symbolen krijgen geen verzonnen source-target.
  Voor een open working copy gebruikt command-admission de bestaande versioned
  runtime-source-statuscache; geen volledige bestandsvergelijking op iedere paint
  en geen nieuwe featurecache. Installatie beëindigt eerst de inspectielifetime.

## Navigatiecorrectie

De live rebindproef start Continue vanuit de Behavior Lens. Zij vond een
bestaande race: `focusChunkSource` startte de asynchrone resource-resolver,
maar de debugger las onmiddellijk de nog niet gekoppelde `activeCodeEditor`.
Navigatie retourneert nu de opening; stop- en faultpresentatie wachten daarop.
De host-framefunctie blijft synchroon: alleen een daadwerkelijke stop maakt
een asynchrone navigatierequest, met de bestaande host-foutrapportage.

## Bewijs

De bestaande `--studio-runtime-inspection`-proef gebruikt een onafhankelijke
Lua-entry, echte cartlib-registratie/grants en de normale Save/Reboot-route:

- twee componenten met dezelfde effect-id, afzonderlijke clocks/cooldowns en
  een gedeelde definitie; daarnaast een ongebruikte registratie en een nooit
  uitgevoerde same-id registratie met de misleidende literal `999`;
- echte Live-knop, gedeelde kiezer, property inspector, callback-Source en Undo;
- no-change `<init>` en stop tussen de twee rebinds: eerst 20/20, dan 30/20;
  gewijzigde bron/Hot Resume: 48/48; compilefout verandert geen guesttijd;
- pending bron verhindert alleen de callbacklink, niet het lezen van de
  actuele definitie; exact Undo herstelt de link;
- Continue, Hot Resume en rewind beëindigen oude selectie-/inspectielifetimes;
- reads veranderen geen sourceversie, guestheapbytes, cycles of callbackteller;
  stilstaande frames behouden ook de gemeten inspectorrijen.

De gedeelde browserdriver kan benoemde checkpoints vastleggen naast het
eindscreenshot. Software presenteert daarbij zijn echte framebuffer; WebGL2
en WebGPU gebruiken hun echte canvas. Geen vervangende testtekening of kopie
van de inspector. De aanvullende TS/C++-socketproef gebruikt de bestaande
closure/save-statefixture, inclusief gelijke adressen en tegengestelde
data-/executionselectie.

Validatie van deze slice:

- IDE-typecheck en de echte browser-Studio-productbuild zijn groen.
- `test:lua`: 1765 geslaagd, 1 bestaande skip.
- Gerichte runtime-inspectie, volledige Studio-workflow en afzonderlijke
  Nemesis-bronnavigatie: software, WebGL2 en WebGPU geslaagd.
- Het ActionEffect-inspectorcheckpoint op 384×288, gepresenteerd op 768×576,
  heeft tussen de drie renderers nul afwijkende RGBA-bytes.
- `bmsx_system_controller_tests` opnieuw gebouwd en uitgevoerd; de uitgebreide
  TS-tegenhanger gebruikt dezelfde fysieke slot-/NMI-/restore-overgangen.
- Beide architectuur-/core-parityaudits, indentation en `git diff --check` groen.
- De tests-projecttypecheck behoudt 48 bestaande diagnostics; vergeleken met
  de ongewijzigde baseline, met alleen verschoven regelnummers genegeerd.

[limbo]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/debugger/limbo_debugger.cpp
[variables]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/variablesView.ts
[qt]: https://github.com/qt-creator/qt-creator/blob/f6e59e3b21aa8e086af27db922d1347a0610dcb4/src/plugins/qmldesigner/instances/nodeinstanceview.cpp
[mame]: https://github.com/mamedev/mame/blob/master/src/emu/debug/debugbuf.cpp
[stack]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/common/debugModel.ts
