# BT-opname: kolomopslag zonder node-objecten per occurrence

Datum: 2026-09-13. Vervolg op [programma-identiteit en completion](behavior_tree_observation_lifetime.md)
en [expliciete compilerpreloads](lua_preload_initialization.md).

## Ownerbesluit vóór de wijziging

Firefox Profiler bewaart stack-/framegegevens in [benoemde kolommen met een
gedeelde index en expliciete lengte][profiler-tables]. De [Chrome-importer][profiler-import]
schrijft rechtstreeks in die kolommen; er is geen blijvend object per frame.
Deze concrete producers zijn gelezen op commit
`a7ff1a5a8c9ec354f415c020962a1c425150c1e9`.

LimboAI [vlakt zijn waargenomen taakboom af in depth-first-volgorde][limbo-data],
maar gebruikt een interleaved transportarray. Dat wireformat is hier niet
nodig: de BMSX-waarnemer en inspector gebruiken al gewone guesttabellen.
Een eigen numeriek veldschema, decoder of tweede geserialiseerde kopie zou
de bestaande grens ingewikkelder maken.

Overgenomen van de profiler: één kolom per feit, met één occurrence-index.
Niet overgenomen: JS typed arrays in de guest, null-/sentinelconversies,
importvalidatie of een nieuw profilerframework. De definitie blijft Lua; dit
is alleen de opslag van feiten uit de werkelijke cartlib-lowering.

## Representatie en callsites

`testlib/behaviour_tree/compile_recorder.lua` blijft de expliciet toegelaten
consument. `programs[compiled]` en `completed_bindings[component]` behouden hun
bestaande zwakke-sleutellifetime. Geen automatische Studio-toelating.

Een opname bewaart `nodes` met de volgende kolommen:

| Kolom | Werkelijke waarde op `execution_index` |
| --- | --- |
| `declaration` | Ordinal van de oorspronkelijke tabelidentiteit binnen deze compilatie. |
| `parent` | Parent-occurrence; de root heeft parent 0. |
| `type` | Effectieve nodetypewaarde uit de compilerlookup. |
| `first_slot`, `last_slot` | Slotinterval van de hele subtree, niet exclusieve nodeopslag. |
| `subtree_end` | Laatste occurrence binnen de subtree in de echte depth-first-lowering. |
| `evaluate`, `operand`, `reset` | Werkelijk geproduceerde guestcalltargets/-waarden, inclusief nil. |

`node_count` komt bij voltooiing uit `layout.execution_index_count`. Tijdens
het geneste bezoek is `parent` een dichte array: elke binnenkomst schrijft
haar parent, ook de root. Haar lengte levert bij vertrek het subtree-einde.
De optionele operand-/resetkolommen bepalen nooit het aantal occurrences;
nil wordt niet vervangen door een sentinel en behoeft geen aanwezigheidbitmap.

De bestaande cold-enter/exit-consument schrijft rechtstreeks in de kolommen.
Er zijn geen per-node recordtabellen, rij-wrappers of achteraf opgebouwde
kolomkopieën. De tijdelijke declaratietabelmap en compilerlayout verdwijnen
na compilatie zoals voorheen. Loskoppelen blijft toekomstige opname stoppen;
completionfeiten zijn geen bewijs van coherente actorvelden tijdens rebind.

| Uitvoeringsgrens | TS / C++ / guest |
| --- | --- |
| Compile-enter/exit en completion | Bestaande optioneel gewiste guesttraces; alleen de expliciete Lua-consument verandert. |
| Guestwaarden, tabellen, zwakke sleutels, GC en restore | Bestaande TS `Value`/`Table` en C++ `Value`/`Table`; geen runtime- of codecwijziging. |
| BT-evaluator, service-/FSM-/ActionEffect-ticks | Geen gewijzigde callsites, lookups of allocaties. |
| Proef-/Studio-readback | Directe kolomlezing via de bestaande guestreader; geen legacy rijreader. |

## Meet- en productgate

Vergelijk de oude en nieuwe recorder binnen dezelfde actuele CPU-fixture,
met de echte compiler, componentbinding en GC. Meet kleine én grote bomen:
vaste kolomtabellen kunnen bij een zeer kleine boom juist meer kosten dan
enkele rijtabellen. Vergelijk niet alleen retained bytes maar ook koude
registratiecycli, allocatie en de ongewijzigde evaluatorbatch.

De bestaande proeven voor gedeelde declaraties, collapse, mutation-aliases,
rebind, GC en restore blijven gelden. Voeg bewijs toe voor sparse nil-kolommen
en de lengte/topologie van brede en diepe bomen. De gedeelde preloadfixture
moet dezelfde kolommen via werkelijke Studio Save/Hot Resume/Reboot/rewind
en de bestaande TS/native replayroute dragen.

Deze opslagstap sluit niet automatisch de gates voor producttoelating,
allocation-/auteursbroncorrespondentie en coherente live-graphstate. Er komt
geen tweede graphdatabase of verzonnen source-id bij om die gaten te verbergen.

## Gemeten opslag en afweging

A/B-meting met de recorder uit `5156e4599` en de kolomrecorder, beide in
**dezelfde actuele** `BT_COMPILATION_PROBE_SOURCE`, dezelfde O3-compilatie en
een nieuw gestarte CPU per meting. De fixture varieert het aantal single-child
wrappers rond een gedeelde task; root-service en -decorator en de twee actors
blijven gelijk. Ook de lege root wordt gemeten. Dit zijn geen gameafhankelijke
regelnummers of apart geïmplementeerde BT-evaluators.

De heapkolommen zijn uitsluitend de **extra retained guestbytes na GC** ten
opzichte van dezelfde registratie zonder opname. De cycluskolommen zijn de
hele koude registratie inclusief eerste constructie van de twee actors:

| Occurrences | Rijen: extra retained | Kolommen: extra retained | Rijen: registratiecycli | Kolommen: registratiecycli |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 324 B | 796 B | 1.310 | 1.347 |
| 3 | 732 B | 988 B | 1.650 | 1.701 |
| 5 | 1.148 B | 1.244 B | 2.059 | 2.124 |
| 65 | 13.628 B | 6.956 B | 12.619 | 13.104 |
| 257 | 53.564 B | 25.388 B | 46.411 | 48.240 |

Opnamesetup blijft afzonderlijk **368 retained guestbytes**. De extra retained
objecten per compilatie dalen van `occurrences + 2` naar **11**: opnamecontainer,
nodecontainer en negen kolommen. Tijdelijke declaratiemaps verdwijnen nog
steeds; de 11 zijn geen claim over alle tijdelijke compilatieallocaties.

Bij 65 occurrences daalt de totale registratie-allocatiedelta van **35.224 B
naar 28.552 B**, en de totale retained delta van **28.316 B naar 21.644 B**.
De opnameopslag halveert bijna; de koude registratie wordt **3,84% duurder**.
Kleine bomen worden niet compacter: hun vaste kolomkosten staan expliciet in
de tabel. Er komt geen omschakelheuristiek tussen twee representaties om dat
te verhullen. Eén direct leesbare opslagvorm vervangt per-occurrence objecten.

De O3-fixturecode met alleen de vier koude kanalen is in deze A/B-proef
165.456 B respectievelijk 165.616 B: **160 B extra** voor de andere recorder.
Beide fixtures bevatten expliciet die testlib-module en dezelfde actuele
checks; de bronwijziging van de checks telt dus niet als recorderverschil.
Gewone cartridges laden deze module niet automatisch.

Zonder geselecteerde opname zijn registratiecycli, allocatie en retentie in
alle vijf groottes gelijk. De 65-occurrence-evaluatorbatch houdt in alle
routes **3.720.145 cycli voor 9.984 ticks van beide actors**, met **nul extra
guestbytes na opwarming**. Geen host-RSS-, peak-memory-, native-timing- of
volledige gameframeclaim. De afweging is koud geheugen tegenover
koude kolomwrites, niet performancewinst op de BT-tickroute.

## Uitgevoerd bewijs

- Tien gerichte BT-proeven slagen: O0/O3 brede/diepe bomen en sparse nil,
  gedeelde declaraties/collapse, mutable input, weak-key lifetime en cycli,
  geneste/falende rebind, herregistratie zonder retained groei en CPU-restore.
  De kostentest controleert de 11 extra retained objecten en gelijke tickkosten.
- De volledige Lua-suite slaagt: **1791 geslaagd, 1 bestaande skip**.
  De twee extra tests gebruiken de bestaande compiler-/CPU-harnasowners;
  geen cartafhankelijke bronregels of gekopieerde evaluators.
- De echte `--studio-preload`-workflow slaagt op software, WebGL2 en WebGPU:
  eerste module-scope registratie, late instance-inspectie, no-change init,
  gewijzigde Save/Hot Resume, compilefout, Undo/Save/Reboot en rewind. De
  guestreader leest dezelfde kolommen na iedere heap-/programovergang.
  Ook de volledige bestaande `--studio`-workflow slaagt op alle drie de
  renderers, inclusief graphauthoring/Undo, focus/pointer en Scenario Cancel.
- `test:runtime-replay` slaagt met de normale game én de onafhankelijke
  preloadcart in TS/C++, inclusief volledige cross-core state/historyvergelijking.
  De bestaande host-rewind- en echte libretro-ABI-proeven slagen eveneens.
  Native CTest: **31/31**. Dit is geen native UI- of native timingmeting.
- IDE-typecheck, core-parity, architecture-boundaries (0 issues), indentation
  en `git diff --check` slagen. De tests-projecttypecheck heeft ongewijzigd
  **46 bestaande diagnostics**; geen nieuwe en geen verzwegen clean-claim.

De nieuwe kolommen worden in de expliciete preloadproef geïnspecteerd, niet
automatisch door een gewone Studio-BT-graph. Producttoelating, bronkoppeling
en graphcoherentie blijven de hierboven benoemde open owners.

Reproduceren:

```sh
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/behavior_compilation.test.ts tests/lua/preload_module.test.ts
npm run test:runtime-replay
node tests/conformance/runtime_replay/browser.mjs --studio-preload dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
```

[profiler-tables]: https://github.com/firefox-devtools/profiler/blob/a7ff1a5a8c9ec354f415c020962a1c425150c1e9/src/profile-logic/data-structures.ts#L115-L165
[profiler-import]: https://github.com/firefox-devtools/profiler/blob/a7ff1a5a8c9ec354f415c020962a1c425150c1e9/src/profile-logic/import/chrome.ts#L706-L721
[limbo-data]: https://github.com/limbonaut/limboai/blob/v1.8.0/editor/debugger/behavior_tree_data.cpp#L20-L52
