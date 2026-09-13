# BT-lowering: uitvoerbare opnameproef, nog geen Studio-debugdatabase

Datum: 2026-09-13. Live owners vergeleken met `265f29364`.
Onderdeel van D3 in [het definitie-inspectieontwerp](behavior_definition_inspection_design.md).

## Productievoorbeelden en afbakening

De volgende implementaties zijn daadwerkelijk gelezen, niet alleen hun API-namen:

- LuaJIT [`jit_attach`][jit-attach] koppelt een waarnemer aan echte VM-events;
  [`lj_vmevent_send`][jit-event] bouwt de argumenten pas voor een geselecteerde
  waarnemer. Een build zonder VM-events wist die route.
- LLVM [`JITEventListener`][llvm-event] ontvangt het werkelijk geproduceerde
  object en kent een afzonderlijke vrijgavelifetime. Een gelijke functienaam
  is geen identiteit van zo'n object.
- LimboAI [`BehaviorTree::instantiate`][limbo-instance] behoudt een taakboom
  door die voor een instance te klonen. Dat is niet BMSX' geoptimaliseerde
  evaluator-/slotrepresentatie en geen reden om een boom per actor toe te voegen.

Overgenomen: observatie bij de feitelijke compilatie, expliciete lifetime en
argument-/code-erasure. Niet overgenomen: een tweede VM-eventbus, een nieuw
CPU-opcode, permanente instruction hooks, taskboomklonen of een editorresource.
De bestaande `blua32.trace` levert al gewone, optioneel gewiste guestinstructies.

## Geïmplementeerde ownergrens

| Punt | Werkelijke producer en inhoud |
| --- | --- |
| `bt.compile.begin` | `program.compile`: de bestaande compiler-owned layout, vóór node-lowering. |
| `bt.compile.node`, binnenkomst | `compile_node`: authored tabelreferentie, nieuw execution-index, effectieve nodetypewaarde en huidige slotgrens. |
| `bt.compile.node`, vertrek | Dezelfde occurrence, nieuwe slotgrens en de feitelijke evaluator/operand/reset na services en decorators. |
| `bt.compile.end` | Het volledig geconstrueerde programma; `create_execution_state` is al gecompileerd. |

De nodetypewaarde wordt bij de bestaande lookup éénmaal gelezen. De waarnemer
krijgt die waarde; hij leest geen eigenschappen opnieuw uit een authored tabel.
De proef dekt ook de daadwerkelijk ondersteunde tabel-`__index`-keten. Functionele
`__index`-metamethodes behoren niet tot de huidige BLua32-runtime; deze slice
voegt die niet toe en doet geen beroep op standaard-Lua-gedrag dat BMSX mist.

Een voltooid compile-event is **geen** geslaagde registrypublicatie of rebind
van alle actors. `library.register` publiceert pas daarna en bindt vervolgens
de geïndexeerde componenten. Bij een compilefout wordt geen voltooid programma
gemeld. Er is geen rollback of vervangende definitie.

`testlib/behaviour_tree/compile_recorder.lua` is de expliciete proefconsument.
Hij wordt niet automatisch in gewone cartridges, Studio of Hot Resume geladen.
Hij bewaart uitsluitend de laatste voltooide opname; loskoppelen stopt nieuwe
opnames, maar wist niet de opname die de proef nog inspecteert.

## Identiteiten en gegevensduur

- `nodes[execution_index]` is een **lowering-occurrence**, niet een source-id,
  taaktype, actorslot of bewezen locatie in een bestand.
- Een tijdelijke map onderscheidt originele tabelidentiteiten binnen één
  compilatie. Twee placements van dezelfde tabel delen daarin één declaratie,
  maar hebben verschillende occurrences en kunnen andere slots krijgen.
- Parent en subtree-einde volgen de werkelijke geneste compilerbezoeken,
  ook wanneer een single-child sequence/selector in de uitvoer verdwijnt.
- `first_slot..last_slot` is het interval voor de **hele subtree**. Het is
  nadrukkelijk niet de exclusieve opslag van die node. Een collapsed wrapper
  en zijn kind kunnen hetzelfde interval en dezelfde evaluator hebben.
- Ook twee verschillende programma's met dezelfde id kunnen exact dezelfde
  stateless callback/operand/reset bezitten. Hun programmaobjecten en opnames
  blijven verschillend; tuple- of stringvergelijking is geen programmakoppeling.
- Na voltooiing blijven alleen nodefeiten, bestaande calltargets, het programma
  en gekozen layoutgegevens behouden. De tijdelijke declaratietabelmap en
  compilerlayout worden niet in de opname opgenomen. De gewone guest-GC ruimt
  die op. Er is geen host-rootmap of eigen snapshotcodec.

De proef volgt echte `library.register`, registry-indexering en componentrebind.
Twee actors delen de uitvoer, maar niet hun taskmemory. Zwakke referenties
bewijzen dat de opname de inputtabellen en vervangen programma's niet onnodig
vasthoudt. O0/O3 CPU-checkpoints spelen dezelfde opname en uitvoering opnieuw
af; na restore worden de nieuwe guestreferenties opnieuw gelezen.

Dit is nog geen volledig geladen BT-propertymodel. Service-/decoratorgedrag
en opaque callbacks draaien in de echte cartlib, maar de meetopname serialiseert
niet elk van hun authored velden of elke interne slotrol.

## Gemeten kosten en keuze

De gedeelde CPU-fixture compileert normale cartlib met 32 single-child wrappers
rond één gedeelde task: 65 lowering-occurrences, 34 verschillende nodetabellen,
een service, een decorator en twee actors. Geen test is gekoppeld aan regels
of actorinhoud uit `nemesis_s` of `pietious`.

O3, byteaantallen volgens de guest-heapaccounting; de eerste twee heapkolommen
zijn de delta van één registratie inclusief eerste actorconstructie:

| Route | Allocatie-delta | Retained na GC | Registratiecycli | 9.984 ticks van beide actors |
| --- | ---: | ---: | ---: | ---: |
| Trace gewist | 20.060 B | 14.688 B | 7.721 | 3.720.145 |
| Oorspronkelijke declaratie behouden | 20.060 B | 19.092 B | 7.722 | 3.720.145 |
| Trace geëmitteerd, niet geselecteerd | 20.060 B | 14.688 B | 7.986 | 3.720.145 |
| Compile-opname geselecteerd | 35.184 B | 28.276 B | 12.592 | 3.720.145 |

Daarnaast kost het eenmalig koppelen van de proefwaarnemer **212 retained
guestbytes**. Die setup staat buiten de registratie-delta en wordt afzonderlijk
gerapporteerd door de test.

Na opwarming voegen die tickbatches in alle vier routes **nul guest-heapbytes**
toe. Dit zijn gerichte machinecyclusmetingen, geen host-RSS, piek-RAM-claim of
benchmark van een volledige world/renderframe. De proef voert de echte
compiler en CPU uit, maar simuleert geen ICU/worldscheduler of trigonometrie.

De volledige fixturecode is 164.820 B met trace-erasure en 165.216 B met emit.
Die emit-delta omvat ook de al bestaande FSM-traces en de expliciet meegelinkte
proefmodule; dit is dus niet de ROM-overhead van uitsluitend de nieuwe BT-events.
Ten opzichte van dezelfde fixture met de twee oorspronkelijke BT-compilerfiles:

- O3: **+4 codebytes, +1 koude registratiecyclus**, gelijke allocatie/retentie
  en gelijke tickcycli. De lokale resultaatbinding levert één extra instructie.
- O0: **+8 codebytes, +66 koude registratiecycli** in deze 65-nodefixture;
  ook daar gelijke allocatie/retentie en tickcycli.
- De algemene erasuretests bewijzen afzonderlijk identieke instructies,
  constants en capture-layout voor een uitgeschakelde trace, ook wanneer die
  naar een outer local verwijst. Geen verborgen closurecapture door die trace.

**Besluit:** een verwijzing naar de oorspronkelijke declaratie is geen
betrouwbare snapshot van wat gecompileerd is. De proef wijzigt die via een
alias terwijl de evaluator en opgenomen feiten onveranderd blijven.
Compilerobservatie is technisch bruikbaar zonder tickinstrumentatie, maar
deze expliciete meetrecorder kost **13.588 extra retained bytes** voor 65
occurrences, plus 212 bytes setup. Hij wordt niet zonder verder opslag-/lifetimeontwerp de Studio-
debugdatabase. Er is geen productkeuze verhuld als een gratis debugflag.

## Bewijs, hergebruik en resterend werk

- Vijf gerichte CPU-proeven: O0/O3 lowering/sharing/GC/restore; gelijke callbacks
  bij verschillende programma's; compilefout/detach; prototypevelden; kosten.
- De bestaande FSM/BT-testbuilder is naar `tests/helpers/cartlib_cpu.ts`
  gebracht en ondersteunt echte aanvullende/vervangende bronmodules. Alle
  bestaande tests gebruiken diezelfde builder. Geen tweede compiler of kopie
  van de evaluator. De gedeelde completion-callhulp rapporteert CPU-cycli.
- Volledige Lua-suite: **1778 geslaagd, 1 bestaande skip**. De IDE-typecheck
  slaagt; de tests-projecttypecheck houdt **46 bestaande diagnostics** over,
  zonder nieuwe diagnostics. Twee oude literal-padtypefouten verdwijnen door
  de gedeelde moduleproducer. Dat is geen claim dat de tests typeclean zijn.
- De opnieuw gebouwde gewone Nemesis-ROM doorloopt de bestaande werkelijke
  Studio-runtime-inspectie op software/WebGL2/WebGPU, inclusief no-change init,
  rebind, gewijzigde bron, compilefout en rewind. Dat is regressiebewijs voor
  de gewone route, niet een al gebouwde live-BT-graphopname.
- Ook de volledige bestaande Studio-workflows slagen op die drie renderers,
  inclusief authoring/Undo, Source, focus, pointerbediening en Scenario Lab.
  Architecture-boundaries (0 issues), core-parity, indentation en
  `git diff --check` slagen.

Reproduceren:

```sh
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/behavior_compilation.test.ts
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/trace_statement.test.ts tests/lua/fsm_hot_resume.test.ts
```

D3 blijft open voor de concrete compacte productopslag, opname vóór de eerste
compilatie zonder Studio-eenmalige boottruc, late attach, precieze program-/
actorbinding tijdens rebind en allocation-/authored-sourcecorrespondentie.
Gewone debug-ROMs en Hot Resume blijven traces wissen; globaal `emit` aanzetten
zou óók de bestaande FSM/ActionEffect-runtime-events aanzetten en is geen
aanvaardbare shortcut. De [compilervervolgslice](lua_trace_selection.md) biedt
nu exacte kanaalselectie; de opnameproef kan daarmee alleen de drie koude
BT-compilekanalen aanzetten. Dat installeert geen Studio-recorder.
Er zijn geen gewijzigde TS/C++-runtimefiles of nieuwe
hardwarevelden. Deze slice claimt geen nieuwe native recorder-/libretroproef.

[jit-attach]: https://github.com/LuaJIT/LuaJIT/blob/c6ffc141a8762b41703f9287d63d93622a13dd8f/src/lib_jit.c#L123-L148
[jit-event]: https://github.com/LuaJIT/LuaJIT/blob/c6ffc141a8762b41703f9287d63d93622a13dd8f/src/lj_vmevent.h#L38-L64
[llvm-event]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/include/llvm/ExecutionEngine/JITEventListener.h#L33-L63
[limbo-instance]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/bt/behavior_tree.cpp#L80-L103
