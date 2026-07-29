# BLua32 physical-emulator handover

> Tijdelijke, gedetailleerde werkoverdracht voor de volgende LLM/engineer.
> Deze checkout is **niet merge-klaar**. Lees dit document en de live diff
> voordat je iets wijzigt. Verwijder dit handoverdocument pas nadat het werk
> veilig is overgenomen.

## 1. Opdracht en gewenste eindtoestand

De oorspronkelijke opdracht was niet slechts een naamswijziging van
`ProgramImage` naar BLua32. Het doel is een echte fantasy-console/emulatorgrens:

- de CPU voert fysieke BLua32-instructies uit vanuit de gewone `SYSTEM_ROM`- en
  `CART_ROM`-vensters;
- firmware bezit reset en cartridgeboot;
- beide cartridgeslots zijn echte, bus-zichtbare media;
- `CP0.EXEC` draagt besturing over naar een fysiek function-recordadres en
  latched daarbij het uitvoerende cartridgeslot;
- er bestaat geen `PROGRAM_ROM`, gecombineerd hostprogramma, host-owned
  instructiebuffer of runtime-linker;
- compiler, linker, rompacker, symbols en Hot Resume zijn tooling;
- save-state bewaart ruwe machine-/VM-toestand en fysieke adressen, geen
  compilerpaden, proto-indexen, decoded images of linker-baselines;
- Hot Resume blijft functioneel, maar wordt uitsluitend als IDE/debugtooling
  bovenop de fysieke emulator gebouwd;
- de fysieke kern mag niet worden vervuild om Hot Resume gemakkelijker te
  maken.

De gebruiker heeft de laatste zin herhaaldelijk als hoofdregel gesteld. De
huidige implementatie schendt die regel nog.

## 2. Niet-onderhandelbare uitvoeringsregels

Lees ook de actieve repo-instructies, maar houd minimaal het volgende aan:

1. Bestudeer vóór implementatie serieuze productievoorbeelden uit hetzelfde
   domein. Voor deze grens zijn vooral MAME-achtige CPU/media/debuggergrenzen en
   volwassen linker/debuggerarchitecturen relevant. Kopieer geen willekeurige
   GitHub-snippets.
2. Performance is verplicht:
   - geen allocatie, parsing, adresclassificatie of symbol lookup per instructie;
   - geen GC-churn of herhaald decodewerk;
   - geen onnodige abstraction layers;
   - geen DTO-validatie van intern geproduceerde data.
3. Geen lokale conversiehelpers in featurecode wanneer de representatie een
   centrale eigenaar heeft.
4. Geen wrappers die alleen callsites mooier maken.
5. Geen fallbacks voor corrupte, incomplete of vreemde interne toestand.
6. Geen rollback/capture/restoreconstructies rond machinewrites tenzij het
   domein werkelijk een transactie modelleert.
7. Geen `Number.isFinite`, `Number.isNaN`, `isNaN` of numerieke `typeof`-guards
   voor intern geproduceerde waarden.
8. Geen `floor`/`ceil` voor woorden, adressen, opcodes, registers of fixed-point.
9. Ruwe woorden en fysieke adressen blijven ruwe woorden en fysieke adressen.
10. TS en C++ moeten hetzelfde hardwarecontract uitvoeren, ook wanneer de
    implementaties niet tekstueel identiek zijn.
11. Tests van bestaande, nog in ontwikkeling zijnde carts mogen hun content
    niet bevriezen. Gebruik gerichte testmedia of de bestaande speciale
    `hot_resume_test`-cart.
12. Een build of unit-test is geen runtimebewijs. Gebruik waar relevant echte
    headless runs, render-parity, framescans en visuele screenshotcontrole.

## 3. Belangrijke ownershipwaarschuwing

De mapnaam `machine/` is historisch onbetrouwbaar als ownershipsignaal.
Tooling is ooit onder `machine/` geplaatst. Daarom zijn bijvoorbeeld:

- `machine/ts/rompack/tooling/*`;
- compiler- en linkerlogica;
- Hot-Resume-buildlogica;

inhoudelijk tooling, ook al staan ze onder `machine/`.

Verplaats die directories **niet in deze slice**. De gebruiker wil die
repositoryherstructurering later afzonderlijk doen. Bepaal ownership nu aan de
hand van gedrag en dependencyrichting:

- leest/executeert dit fysieke machinebits, dan is het runtime/hardware;
- produceert of interpreteert het source-, linker-, symbol- of revisiedata voor
  de IDE, dan is het tooling;
- de directory is hierbij geen bewijs.

## 4. Exacte repositorytoestand bij overdracht

- Werkdirectory: `/home/boaz/BMSX`
- Laatste commit op `HEAD`:

  ```text
  5830b5f69 perf(render): batch non-overlapping GX feedback draws
  ```

- Er is geen commit gemaakt voor de BLua32-slice.
- De werkboom bevat een zeer grote onafgeronde diff:
  - 155 tracked bestanden geraakt;
  - circa 6201 regels toegevoegd en 9200 verwijderd;
  - meerdere nieuwe, nog untracked BLua32-bestanden;
  - meerdere oude `program_*`-bestanden verwijderd.
- Voer direct uit:

  ```bash
  git status --short
  git diff --stat
  git diff --check
  ```

- **Niet resetten, niet reverten en niet blind alles committen.** De gebruiker
  vroeg expliciet het werk te laten liggen zodat een andere LLM het gericht kan
  overnemen.
- `docs/gx_psx_replacement_workplan.tmp.md` bevat wijzigingen buiten deze
  BLua32-opdracht. Behandel dat bestand als unrelated en wijzig het niet zonder
  afzonderlijke scopecontrole.
- Dit handoverdocument is de enige wijziging die na het stopverzoek bewust is
  toegevoegd.

### 4.1 Hoe deze slice tot stand kwam

De aanleiding was dat de oude emulator een hostconcept `Program` kende:

- compileroutput werd als één gecombineerd programma aan de runtime gegeven;
- runtimeframes en closures waren gekoppeld aan host-`protoIndex`-waarden;
- source `path` en programmetadata lekten richting execution/debugstate;
- het eerder verwijderde `PROGRAM_ROM` was mede ontstaan om live door de
  TypeScript-runtime gecompileerde cartcode ergens “executable” te maken.

De gebruiker wees terecht op het fundamentele verschil:

> Een echte CPU voert instructies uit. Een emulator hoort geen host-`Program`
> als alternatieve machinewerkelijkheid nodig te hebben.

Daarna is het plan meerdere keren door contextvrije subagents beoordeeld.
Belangrijke conclusies uit die planreviews:

1. `path` mag nooit CPU-identiteit zijn.
2. Een compiler mag intern proto-indexen gebruiken, maar de gelinkte/runtime
   representatie moet fysieke function records en adressen gebruiken.
3. Hot Resume moet behouden blijven, maar strikt als hosttooling.
4. Het fysieke media-/CPU-contract moet zelfstandig werken zonder IDE.
5. Een debugadapter mag fysieke state observeren en eventueel generiek muteren;
   de CPU mag geen source revision of linkerlineage begrijpen.
6. Overengineering voorkomen betekent niet terugvallen op het oude Program;
   het betekent eerst het minimale fysieke contract bouwen en pas daarna een
   smalle debuggerlaag.

De naamgeving is daarbij bewust vastgesteld:

- BLua is de Lua-variant/source-dialect;
- BLua32 is de fysieke 32-bit instructierepresentatie;
- het ROM-object heet `__blua32__`, niet `__lua32__` en niet `__blue__`.

Vervolgens is begonnen aan één grote verticale slice:

1. fysieke ROM-header en imageformat;
2. compilerobject + linker;
3. TS/C++ image-decode;
4. TS/C++ CPU-uitvoering;
5. firmwareboot en `CP0.EXEC`;
6. dual-slot;
7. save-state;
8. debug/symbols;
9. rompacker/rominspector;
10. IDE/Hot Resume.

De doorslaggevende procesfout was dat stap 10 niet als latere laag is
behandeld. Hot-Resume-eisen zijn tijdens dezelfde refactor terug de CPU in
gemodelleerd. Daardoor is de fysieke richting grotendeels zichtbaar, maar de
ownergrens nog niet zuiver.

### Belangrijkste nieuwe bestanden

TypeScript:

- `machine/ts/rompack/tooling/blua32_image.ts`
- `machine/ts/rompack/tooling/blua32_symbols.ts`
- `machine/ts/lua/compiler/program.ts`
- `machine/ts/lua/module_path.ts`
- `machine/ts/machine/runtime/lua_scratch.ts`
- `machine/ts/rompack/tooling/blua32_linker.ts`
- `machine/ts/rompack/tooling/blua32_revision.ts`
- `machine/ts/rompack/tooling/blua32_tail.ts`
- `machine/ts/rompack/tooling/rom_prefix_layout.ts`
- `ide/workbench/blua32_boot.ts`

C++:

- `machine/cpp/rompack/tooling/blua32_image.h/.cpp`
- `machine/cpp/machine/runtime/lua_scratch.h/.cpp`

Tests/tooling:

- `tests/helpers/blua32.ts`
- `tests/cpp/support/blua32_test_rom.h/.cpp`
- `tests/rompacker/blua32_image.decode.test.ts`
- `tests/rompacker/blua32_image.module_paths.test.ts`
- `tests/rompacker/blua32_linker.test.ts`
- `tests/rompacker/blua32_tail.layout.test.ts`
- `tests/lua/lua_sources.test.ts`
- `scripts/rompacker/blua32_image_builder.ts`
- `scripts/dump_blua32_symbols_from_rom.ts`
- `scripts/bootrom/platforms/hostrunner/host_test_cartridge.ts`

### Belangrijkste verwijderde oude concepten

Onder andere:

- `machine/ts/machine/program/loader.ts`
- `machine/ts/machine/program/scratch.ts`
- `machine/ts/rompack/tooling/program_linker.ts`
- `machine/ts/rompack/tooling/program_revision.ts`
- `machine/ts/rompack/tooling/program_tail.ts`
- `machine/ts/rompack/tooling/rom_layout.ts`
- `machine/cpp/machine/program/*`
- `machine/ts/ide/runtime/program_boot.ts`
- oude program-image testhelpers en tests.

Controleer de deleties inhoudelijk; neem niet aan dat iedere verwijderde
functionaliteit elders correct terugkwam.

## 5. Wat er inhoudelijk al is gebouwd

### 5.1 Fysiek `__blua32__`-imagecontract

De ROM-header publiceert nu direct:

- offset en bytecount van `__blua32__`;
- fysieke startup-, IRQ- en exception-function-recordadressen;
- een static-layout token.

Het BLua32-image heeft een vast binary contract met onder andere:

- header;
- `.rodata`;
- `.data` load image en RAM-VMA;
- `.bss` RAM-VMA/bytecount;
- function records;
- upvalue records;
- constants;
- gewone en system-global names;
- shared strings;
- text.

Function-recordadressen zijn 16-byte-aligned en zijn bedoeld als fysieke
functie-identiteit. Frames en closures gebruiken fysieke adressen in plaats van
een gecombineerd host-`protoIndex`.

Eigenaren:

- binary decode:
  `machine/{ts,cpp}/rompack/tooling/blua32_image.*`;
- linking:
  `machine/ts/rompack/tooling/blua32_linker.ts`;
- ROM-tail:
  `machine/ts/rompack/tooling/blua32_tail.ts`;
- outer header:
  `machine/ts/rompack/tooling/header_encode.ts`.

### 5.2 Systeem- en cartridgecode zijn gescheiden fysieke domeinen

Het oude hostmodel met één gecombineerd `Program` is grotendeels verwijderd:

- system BLua32 wordt tegen `SYSTEM_ROM_BASE` gelinkt;
- cart BLua32 wordt tegen de gedeelde `CART_ROM_BASE`-aperture gelinkt;
- cart-linking consumeert de gepubliceerde firmware-ABI/symbolen;
- runtime linkt niets;
- firmwareboot schrijft een fysiek cart-startupadres naar `CP0.EXEC`.

### 5.3 Dual-slot uitvoering

Het beoogde en grotendeels geïmplementeerde model:

- beide sockets delen dezelfde cartridge-aperture;
- `CART_SELECT` kiest de socket voor gewone CPU-datacycles;
- een cartridgegerichte `CP0.EXEC` latched het slot voor instruction fetch;
- het wisselen van `CART_SELECT` tijdens cartuitvoering retarget instructiefetch
  niet stilzwijgend;
- firmware scant slots in fysieke volgorde en kiest het eerste executable
  medium;
- de host kiest geen bootcart;
- een tweede cart kan data/RAM/mailbox leveren zonder executable code te hoeven
  leveren.

### 5.4 Guest-inerte niet-uitgevoerde cartridge

Een tweede executable cartridge wordt als media gezien, maar zijn runtime
constants, strings, globals en static closures horen pas te worden
geactiveerd wanneer `CP0.EXEC` die socket werkelijk selecteert. Dit voorkomt dat
een ongebruikte cart Lua-object-ID's, string-ID's of table-iteratie beïnvloedt.

Er bestaat hiervoor een test in
`tests/lua/system_controller.test.ts`:

```text
an unexecuted second cartridge does not alter guest identity allocation
```

Let op het onderscheid:

- fysiek aanwezige media mag firmware- en busgedrag beïnvloeden;
- het host-side vooraf materialiseren van zijn Lua-runtimeobjecten mag guest
  identity niet beïnvloeden.

### 5.5 Save-state gebruikt fysieke adressen

De save-statewijzigingen vervangen onder andere:

- closure `protoIndex` door `functionAddress`;
- frame `protoIndex` door `functionAddress`;
- combined-program state door het execution-cartridge-slot plus ruwe PC's;
- debug/compilermetadata wordt niet als machine-state geserialiseerd.

Restore bouwt decoded images opnieuw uit de ingevoerde ROM en reconnect fysieke
function-recordadressen en PC's.

De gebruiker accepteert expliciet dat restore na een Hot Resume de **huidige**
ROM-revisie gebruikt. Een save-state hoeft een oude IDE-development-tail niet
te resurrecten.

### 5.6 Symbols en release/debug-ROMs

Bewezen gedrag op vers gebouwde artifacts:

- debug BIOS embedt `__blua32_symbols__`;
- de debug-sidecar bevat byte-identiek dezelfde system-symbolpayload;
- release BIOS embedt geen symbols;
- release sidecar bestaat wel voor cart-linking/tooling;
- debug carts embedden hun eigen symbols;
- release carts niet.

Gemeten debug-resultaat:

```json
{"embeddedBytes":1539413,"sidecarBytes":1539413,"identical":true}
```

Gemeten release-resultaat:

```json
{"embedded":false,"sidecarBytes":1538874}
```

`BIOSSymbolsPath = BIOSRomPath + ".blua32-symbols"` is dus een build/linkerinput,
niet een vervanging voor embedded symbols in de debug-ROM.

### 5.7 Ruwe ROM-residency

De bredere diff verwijdert het oude whole-ROM normalize/decompressmodel:

- ROM-bestanden blijven hun exacte fysieke lengte;
- er wordt niet voor de volledige 512 MiB-aperture gealloceerd;
- native file-backed media kan read-only gemapt worden;
- carts worden niet als geheel gecomprimeerd;
- IMGDEC/IMD1 is voor gecomprimeerde beeldassets;
- audio heeft zijn eigen codec.

Dit is belangrijk voor het doel om bijvoorbeeld een 512 MiB-cart te kunnen
bouwen zonder 512 MiB extra hostkopie of apertureallocatie.

## 6. Bugs die tijdens dit werk al zijn gevonden en gefixt

Onderstaande fixes zijn waardevolle context. Herintroduceer deze fouten niet
tijdens cleanup.

### 6.1 C++ BLua32-decoder had unsigned underflow bij rangechecks

Een rangecheck in de native decoder kon eerst unsigned onderflowen voordat de
grensvergelijking plaatsvond. Dat maakte corrupte/buitenliggende recordranges
potentieel verkeerd valide.

De huidige C++-decoder splitst dit op:

1. controleer `address < imageAddress`;
2. bereken daarna pas `offset`;
3. controleer `offset > imageByteCount`;
4. controleer `byteCount > imageByteCount - offset`.

Zie `machine/cpp/rompack/tooling/blua32_image.cpp::imageOffset`.

### 6.2 Ongeldig `CLOSURE`-doel gaf TS TypeError of native UB

Een fysiek `CLOSURE`-operand kon buiten de function table wijzen. TS liep dan
door naar een undefined object; native kon ongeldige data derefereren.

De CPU-resolutie hard-halt nu wanneer het fysieke function-recordadres niet
bestaat. Dit is machinegedrag, geen host-exceptionfallback.

Gerichte TS-test:

```text
invalid CLOSURE targets hard-halt without entering host error handling
```

Controleer de equivalente C++-test/dispatch tijdens iedere verdere refactor.

### 6.3 Hot Resume activeerde een nog nooit uitgevoerde tweede cart

De eerste revisieroute decodeerde/activeerde gereviseerde cartridges te vroeg,
waardoor een ongebruikte tweede cart guest object/string identity kon
veranderen.

De huidige route houdt een niet-geactiveerde cart als media-image en vervangt
die zonder runtimeobjecten aan te maken. De eerder genoemde
identity-allocationtest dekt dit gedrag.

### 6.4 Cross-image callstack kende de PC aan het verkeerde frame toe

Een callee bewaart de callsite van zijn caller. Voor stackframe `i` is de
historische PC daarom:

```text
frames[i + 1].callSitePc
```

en niet `frames[i].callSitePc`.

Dit is hersteld in TS en C++. Er zijn tests met:

- cart entry;
- system const-module caller;
- system leaf;
- een halt in de leaf;
- controle dat iedere stack-PC met de juiste image/symbolrange wordt
  gecombineerd.

TS-test:

```text
cross-image call-stack PCs belong to the frame image
```

### 6.5 TS en C++ verschilden bij branch- en RFE-functiongrenzen

TS begrensde branches/RFE tot het huidige function record, terwijl C++ dat niet
op exact dezelfde manier deed. Dit is gespiegeld zodat een branch of RFE niet
stil in aangrenzende functietext terechtkomt.

Voorbeelden:

- `BLua32 branches cannot enter adjacent function text`;
- invalid-RFE tests in TS en C++ supervisor suites.

### 6.6 C++ debugging was tijdelijk als lege stub geïmplementeerd

Tijdens de refactor stond tijdelijk:

```cpp
std::optional<SourceRange> CPU::getDebugRange(u32) const {
    return std::nullopt;
}
```

De gebruiker merkte terecht op dat dit functionaliteit verwijderde. De huidige
code resolveert weer het execution image en gebruikt
`blua32SourceRangeAtPc`. Verwijder debugging niet opnieuw om de fysieke
architectuur eenvoudiger te laten lijken.

### 6.7 Misleidende `[CPU]`-prefixen in runtimefouten

Nieuwe fouten kregen aanvankelijk handmatig prefixes zoals `[CPU]`. Die zijn
uit de geraakte foutmeldingen verwijderd. Voeg zulke handmatige componenttags
niet opnieuw toe.

### 6.8 Boot-header kreeg onnodige eigen version-wrapper

Een eerdere tussenimplementatie voegde een 64-byte
`BLUA32_BOOT_HEADER_VERSION`-wrapper en host-error toe. Dat was een kunstmatige
laag boven de bestaande ROM-header en is verwijderd.

De huidige bootvelden staan rechtstreeks in de fysieke ROM-header; zie
`machine/{ts,cpp}/spec/bmsx/rom_header.*` en
`BMSX_ROM_BOOT_HEADER_SIZE = 60`.

Let op: het **BLua32-imageformat zelf** bevat nog wel magic/version en de
runtime-decoders gooien bij ongeldige images host-errors. Dat resterende
validatie-eigenaarschap is nog niet definitief geaccepteerd; zie de open
problemen hieronder.

### 6.9 String-discriminants in linker-hotdata

Een eerdere linkeropzet gebruikte per function slot objecten met
`kind: "function"`/`kind: "tombstone"` en `.some()` met stringvergelijkingen.
Dat is teruggebracht naar dichte numerieke arrays plus een
`hasTombstones`-boolean.

Huidig relevant type:

```ts
type FunctionRecordLayout = {
    protoIndexBySlot: number[];
    functionIds: string[];
    hasTombstones: boolean;
};
```

### 6.10 Dubbele source-range types

`machine/ts/lua/semantic/source_range.ts` definieerde opnieuw
`SourcePosition`/`SourceRange`. Dat is verwijderd; het bestand importeert en
re-exporteert nu de centrale types uit `blua32_symbols.ts`.

Dit was de laatste lean-code cleanup vóór de huidige CPU-tussenwijziging.

### 6.11 Lokale arrayvergelijker dupliceerde een centrale helper

`blua32_revision.ts` had een lokale `numberListsMatch`. Die is verwijderd ten
gunste van de bestaande centrale `arrays_equal` uit
`machine/ts/common/arrays_equal.ts`.

### 6.12 Native hostpackagekopieën zijn verwijderd

De native runtime bouwde parallelle hostpackages met gedecodeerde ROM-assets.
Dat botste met één fysieke ROM als data-eigenaar, kon grote carts dupliceren en
liep niet gelijk met TS. De huidige richting laat runtimeconsumenten de raw ROM
gebruiken en houdt package-/TOC-inspectie bij tooling.

## 7. Bekende architectuurfouten die nog NIET zijn opgelost

Dit is het belangrijkste deel van de overdracht.

### 7.1 `Revision` zit nog in de CPU-kern

Huidige foute surface in `machine/ts/machine/cpu/cpu.ts`:

```ts
export type Blua32ExecutionImageRevision = {
    functionAddresses: Uint32Array;
    pcAddresses: Int32Array;
};

export type Blua32MediaRevision = {
    system: Blua32ExecutionImageRevision | null;
    cartridgeSlots: [
        Blua32ExecutionImageRevision | null,
        Blua32ExecutionImageRevision | null,
    ];
};
```

en:

```ts
public applyExecutableMediaRevision(
    symbols: Blua32MediaSymbols,
    revision: Blua32MediaRevision,
): void
```

Dit is expliciet afgewezen.

Waarom:

- echte hardware kent geen source revision;
- een fysieke CPU kent geen linkerbaseline;
- PC-relocatie op basis van sourcemaps is IDE/debuggerbeleid;
- `machine/ts/rompack/tooling/blua32_revision.ts` importeert nu zelfs een
  revisiontype uit de CPU, dus de dependencyrichting is omgekeerd;
- de CPU werd opnieuw een host-engine die source-edits begrijpt.

**Niet oplossen door het type te hernoemen, te verplaatsen naar een ander
CPU-bestand, of er een nette class/facade omheen te zetten.** De revisionkennis
moet uit de fysieke CPU.

### 7.2 De laatst toegevoegde `relocatedPc` is expliciet afgewezen

Direct vóór het stopverzoek werd in
`CPU.applyExecutableMediaRevision()` deze lokale helper toegevoegd:

```ts
const relocatedPc = (
    previousImage: Blua32ExecutionImage,
    imageRevision: Blua32ExecutionImageRevision,
    pc: number,
): number => {
    const wordIndex =
        (pc - previousImage.layout.header.textAddress) / INSTRUCTION_BYTES;
    return (wordIndex >>> 0) < imageRevision.pcAddresses.length
        ? imageRevision.pcAddresses[wordIndex]
        : -1;
};
```

De gebruiker wees zowel de lokale helper als, belangrijker, het onderliggende
CPU-`Revision`-concept af.

Deze code staat nog in de werkboom omdat de gebruiker vroeg niets meer te
reverten of wijzigen. Beschouw dit als een gemarkeerde, afgewezen tussenstaat,
niet als een oplossing die alleen nog tests mist.

### 7.3 Hot Resume houdt oude executable buffers aan frames vast

Het huidige document en de huidige CPU laten ongemapte actieve continuations
doorlopen via een oud `Blua32ExecutionImage` dat door het frame wordt
vastgehouden.

De gebruiker heeft dit expliciet omschreven als:

> Oude actieve frames draaien vanuit een los hostbuffer — totale bullshit.

Dit is dus geen geaccepteerd eindcontract, ook al staat in
`docs/architecture.md` momenteel tekst die dit beschrijft als retained old
development-tail bytes.

Een volgende oplossing mag de oude-bufferconstructie niet cosmetisch
verstoppen. De fysieke ROM moet de executable eigenaar blijven. Als Hot Resume
meer nodig heeft, moet de IDE/debugger dat bovenop de fysieke kern oplossen.

### 7.4 Symbols/source metadata zitten nog in TS én C++ CPU/runtime

De documenten zeggen dat debugmetadata een optionele toolingasset is, maar de
huidige code doet onder andere:

- `CPU.mountExecutableMedia(symbols: Blua32MediaSymbols)`;
- `Blua32MediaImage.symbols`;
- `Blua32ExecutionImage.symbols`;
- `CPU.activeSymbols()`;
- `CPU.getDebugRange()`;
- profilerconfiguratie rechtstreeks met symbolmetadata;
- C++ `CPU` includeert `blua32_symbols.h`;
- C++ runtime bezit `m_blua32MediaSymbols`.

Dit is minstens verdacht en nog niet als echte emulatorgrens bewezen.

De gebruiker had eerder expliciet bezwaar tegen cartridge-symbolstate in de
CPU. Debugfunctionaliteit moet behouden blijven, maar dat bewijst niet dat de
CPU zelf de symbolowner moet zijn. Onderzoek een volwassen emulator/debugger-
grens:

- CPU exposeert ruwe fysieke PC/function/framegegevens;
- debugger/tooling associeert die met het actieve mediaslot en sidecar;
- release/hardwaregedrag mag geen symbolpayload nodig hebben.

Voer dit niet half uit door opnieuw `getDebugRange()` leeg te maken. Verplaats
ownership met behoud van debugger-, stacktrace-, profiler- en fault-output.

### 7.5 Runtime image-decode gooit host-errors voor ROM-inhoud

`decodeBlua32Image` in TS en C++ valideert magic, version, grootte, uitlijning,
ranges en tags en gooit host-exceptions.

Open ontwerpvraag:

- wat hoort bij de externe media-loadgrens;
- wat hoort bij packer/linkerproductie;
- wat hoort bij CPU-busgedrag;
- hoe vermijdt native code UB zonder dat de CPU source-/containerbeleid bezit?

De repo-regels eisen dat intern geproduceerde data correct is en dat weird maar
representable hardwarebits deterministisch doorstromen. Los dit op bij de echte
media/format-owner; voeg geen extra CPU-guards of silent fallback toe.

### 7.6 Hot Resume is TS-only CPU-gedrag

De fysieke TS- en C++ CPU horen hetzelfde machinecontract te implementeren.
IDE-only source-revisie hoeft niet in C++, maar precies daarom hoort die logica
niet in de TS CPU-kern.

De huidige `applyExecutableMediaRevision` bestaat alleen in TS en bewijst dat
de scheiding nog niet af is.

### 7.7 `previous`/baseline hoort uitsluitend bij tooling

`Blua32LinkBaseline` en `previous?: Blua32LinkBaseline` staan momenteel in
`machine/ts/rompack/tooling/blua32_linker.ts`. Dat is inhoudelijk tooling en is
daarom niet automatisch fout.

De harde grens:

- linker/IDE mag vorige buildlayout bijhouden;
- CPU, Runtime, Memory en fysieke media mogen geen previous/baseline kennen;
- een directoryverhuizing van tooling gebeurt later.

Controleer dat geen baseline opnieuw via een convenience API de runtime in
lekt.

### 7.8 CPU bezit afgeleide high-level execution images

Decoded pages, runtime constants, function-recordindexes en inline caches zijn
legitieme emulatorcaches. Maar controleer streng:

- een frame moet fysieke machine-/VM-identiteit bewaren;
- cacheobjecten mogen niet de fysieke ROM vervangen;
- mediareplacement moet caches invalidaten zonder sourcebegrippen;
- save-state mag caches niet serialiseren;
- geen oude cache mag een vervangen ROM als alternatieve executable backing
  blijven gebruiken.

Dit is de kern van de oude-framefout.

**Aanvulling — dit bleek groter dan hier beschreven.** Een structurele audit
van `cpu.ts`/`cpu.cpp` (zie "Taak 0" in
`docs/blua32_physical_emulator_handover_followup.md` voor het volledige
overzicht) legde bloot dat de CPU-klasse/het CPU-bestand aanzienlijk meer
verantwoordelijkheid draagt dan §7.8 hierboven suggereert: ROM/media-mount-
en-decode, cartridge-busslotresolutie, en profiler-orkestratie/opmaak zitten
er allemaal op, terwijl geen enkele daarvan hoort bij een "echte" CPU-core
(vergelijk MAME-CPU-devices). `cpu.ts` is bovendien geen enkele klasse maar
tien (inclusief een volledige 656-regel generieke Lua-hashtable-
implementatie, `Table`, die niets met de CPU te maken heeft). De gebruiker
heeft expliciet besloten dat het ontvlechten hiervan **vóór** §7.9/§7.10
moet gebeuren, omdat §7.10's eager-decode-probleem er een symptoom van is.
Zie de follow-up voor de volledige, met codeverwijzingen onderbouwde audit
en de precieze scheidslijn tussen wat wél (builtins met echte cyclus-
kosten, register-/frame-/protected-call-machinery) en niet (media-mount,
profiler-opmaak) op de CPU thuishoort.

### 7.9 Dual-slot IDE-sourceownership is nog niet af

De diff heeft een goede eerste stap:

- `RuntimeSourceState.cartridgeSlots` bewaart per slot een eigen ROM,
  package, source registry, project root en installed-source baseline;
- dirty state is per slot:
  `cartridgeBlua32MediaDirty: [boolean, boolean]`;
- workspacecode markeert het slot door registry-identiteit in plaats van één
  globale cartbron aan te nemen.

Maar er zijn nog concrete fouten:

1. `CartEditor` zet `isAvailable = false` wanneer **enige** executable cart geen
   source bevat. Daardoor kan een source-loze secundaire cart de editor voor de
   geldige primaire developmentcart uitschakelen:

   ```ts
   for (let slot = 0; slot < sourceState.cartridgeSlots.length; slot += 1) {
       const cartridge = sourceState.cartridgeSlots[slot];
       if (cartridge !== null
           && cartridge.rom.header.blua32ImageOffset
           && !cartridge.luaSources.can_boot_from_source) {
           this.isAvailable = false;
           break;
       }
   }
   ```

2. Meerdere IDE-structuren identificeren bronnen nog uitsluitend met `path`,
   onder andere tab/context IDs en
   `luaChunkEnvironmentsByPath: Map<string, LuaEnvironment>`.
3. Twee carts met allebei `entry.lua` kunnen daardoor nog dezelfde editor- of
   environmentidentiteit raken.
4. `resolveRuntimeLuaSource` gebruikt een geordende registrysearch. Dat kan een
   leeslookup voor de actieve context oplossen, maar is geen unieke blijvende
   documentidentiteit voor open tabs, saves of dirty buffers.

Los dit niet op met lelijke tekstprefixes die overal handmatig worden
samengesteld. Gebruik de bestaande registry/media/project-context als eigenaar
en ontwerp één professionele documentidentiteit bij de IDE/workspace-owner.
De fysieke CPU mag hier uiteraard niets van weten.

### 7.10 Cartridge-images worden nog te vroeg volledig gedecodeerd

`CPU.mountExecutableImages()` roept momenteel voor beide slots
`decodeExecutableMedia()` aan. Die functie leest niet alleen de raw cartheader,
maar decodeert meteen de volledige BLua32-layout, function records, constants,
strings en global names. Alleen de omzetting naar guest runtimevalues wordt
uitgesteld tot `cartridgeImageForExecution()`.

Dat is beter dan beide carts volledig activeren, maar nog verdacht:

- een nooit uitgevoerde tweede cart kost al host parsing en allocaties;
- een ongeldig executable image in een ongebruikt slot kan bij hostmount
  throwen voordat firmware ooit dat slot executeert;
- de fysieke firmware leest zelf raw headers en kan stoppen zodra een eerdere
  geldige bootcart is gekozen;
- voor grote carts moet de host niet onnodig code-/metadataobjecten
  materialiseren.

Dit mag niet met `try/catch` en “negeer corrupte slot 1”-fallback worden
opgelost. Maak de producer/media-/executiongrens fysiek:

- insertion bezit raw ROM-backing;
- firmware ziet raw headerwoorden;
- alleen daadwerkelijk geselecteerde execution hoort de benodigde derived
  decodecache te creëren;
- invalid execution krijgt het vastgelegde machine/media-loadgedrag zonder een
  alternatieve veilige hostwerkelijkheid.

Onderzoek daarbij de C++-route tegelijk; voorkom dat TS lazy wordt terwijl
native eager blijft.

**Aanvulling (zie `docs/blua32_physical_emulator_handover_followup.md`
voor het volledige overzicht):** BMSX heeft het goedkope presence-signaal al
hardwarematig — `CartridgeController.readStatusThunk()` exposeert
`IO_CART_STATUS` met `SLOT0_PRESENT`/`SLOT1_PRESENT`, los van enige
BLua32-decode — en `decodeExecutableMedia()` heeft al een goedkope early-out
bij ontbrekende/ongeldige header. De lek zit specifiek bij een aanwezige,
geldige, maar nooit door `cartridgeController.selectedSlot()` geselecteerde
slot: die wordt bij elke `mountExecutableImages()` toch volledig gedecodeerd.
Twee bestaande (niet 1-op-1 te kopiëren, wel illustratieve) hardware-
precedenten voor exact dit onderscheid: de MSX-BIOS-slotscan (een niet-
uitvoerbare cartridge zoals de Konami Sound Cartridge bij (SD) Snatcher
wordt door de "AB"-header-scan simpelweg nooit gezien, dus nooit gedecodeerd
als programma) en de Nintendo DS' asymmetrische Slot-1/Slot-2 (Slot-2 is
direct memory-mapped en wordt alleen door het draaiende Slot-1-programma op
eigen initiatief geprobeerd, nooit door de hardware zelf geïnterpreteerd).

## 8. Auditorbevindingen op het exacte stoppunt

Er waren drie subagents:

- `blua32_release_audit`: afgerond met `NO BLOCKERS`, maar dit oordeel dateert
  van vóór de laatste twee implementation-auditorbevindingen;
- `blua32_final_context_audit`: eerder interrupted;
- `blua32_implementation_audit`: bij het stopverzoek interrupted.

De implementation-auditor leverde vlak vóór het stopverzoek twee concrete
blockers.

### 8.1 Niet alle continuation-PC's werden gerealloceerd

De oude `applyExecutableMediaRevision` wijzigde alleen `frame.pc`. Maar live
continuations bezitten ook:

- de `callSitePc` van het kind, die bij de caller hoort;
- `epcWord` bij een actieve exception/IRQ;
- `nmiReturnEpcWord` bij een geneste NMI.

Gevolgen:

- RFE kan na een edit naar een oud fysiek adres terugkeren;
- RFE-boundsvalidatie kan hard-halten tegen het nieuwe function record;
- stacktrace/source-attributie kan oud PC + nieuw image combineren.

De afgewezen laatste patch probeerde dit alsnog **binnen de CPU revisionroute**
te repareren door per eigenaar te mappen. Het onderliggende bugbewijs blijft
waardevol, maar die oplossingslocatie is fout.

Een toekomstige IDE/debuggeroplossing moet alle door een continuation bezeten
fysieke PC's coherent behandelen. Voeg geen RFE-fallback toe.

### 8.2 System-only Hot Resume splitste de fysieke SYSTEM_ROM

De uitvoeringimage had eerder:

```ts
systemImage: Blua32ExecutionImage;
```

Een geactiveerde cartridge snapshotte:

```ts
image.systemImage = this.systemImage;
```

Na een system-only Hot Resume bleef die cartridge daardoor nieuwe system calls
naar het oude system image sturen, terwijl IRQ/exception al de nieuwe firmware
gebruikten. Dat creëerde twee gelijktijdige SYSTEM_ROM-realiteiten, wat fysiek
onmogelijk is.

Direct vóór het stopverzoek zijn daarom in TS:

- `Blua32ExecutionImage.systemImage` verwijderd;
- de `null!` circular-reference placeholder verwijderd;
- system-address resolution veranderd naar `this.systemImage`;
- het ongebruikte TS-only `mediaRevision`-veld verwijderd.

Deze richting lost het snapshotsymptoom logisch op en verwijdert een lelijke
placeholder, maar:

- dit gebeurde na de laatste volledige testbundel;
- alleen TypeScript typecheck is erna gedraaid;
- er is geen nieuwe regressietest voor system-only Hot Resume;
- de bredere revisionroute in CPU bleef fout;
- C++ had deze specifieke TS Hot-Resume-snapshotroute niet.

Behandel deze wijziging dus als onvolledig gevalideerde salvage, niet als
afgeronde fix.

## 9. Exact waar het werk stopte

De laatste werkzaamheden verliepen als volgt:

1. Een lean-code audit vond:
   - dubbele source-range types;
   - een gedupliceerde arrayvergelijker;
   - een `systemImage: null!` self-reference placeholder;
   - een ongebruikt TS-only `mediaRevision`-veld.
2. De eerste twee duplicaties zijn verwijderd.
3. De `systemImage`-snapshot en `mediaRevision` zijn verwijderd.
4. De auditor meldde stale `callSitePc`/EPC/NMI-PC's.
5. Er werd ten onrechte opnieuw geprobeerd dit probleem in
   `CPU.applyExecutableMediaRevision` op te lossen.
6. De lokale `relocatedPc`-helper maakte zichtbaar dat de fundamentele fout nog
   bestond: de CPU kende nog steeds `Revision`.
7. De gebruiker stopte het werk en vroeg om deze handover.

Na stap 5 is alleen uitgevoerd:

```bash
npx tsc --noEmit --project tsconfig.json
```

Dat commando was groen. Er zijn na die stap geen runtime-, C++-, Hot-Resume- of
paritytests gedraaid.

## 10. Hot-Resume-functionaliteit die behouden moet blijven

“Hot Resume is tooling” betekent **niet** dat de functionaliteit mag verdwijnen.
De gebruiker heeft eerder fel gecorrigeerd toen “Rebuild Program” de bestaande
functionaliteit leek te vervangen.

Het vereiste gedrag:

- `Ctrl+Shift+S` doet save + Hot Resume;
- de eerste, tweede, derde en volgende source-edit worden allemaal opgepakt;
- de runtime en CPU-objectidentiteit blijven bestaan;
- live Lua-heapobjecten blijven identiek;
- globals blijven bestaan;
- RAM, devices en audio blijven live;
- `new_game` wordt niet opnieuw uitgevoerd;
- `init` wordt opnieuw uitgevoerd zodat registratie-eigenaren gewijzigde code
  opnieuw publiceren;
- systeem- en cartwijzigingen kunnen samen;
- alleen een systemwijziging moet ook werken;
- een data-only tweede cart mag niet worden vervangen of geactiveerd;
- `print()` blijft zichtbaar via de platformlog naar IDE-terminal én
  `console.log`/hostterminal;
- een koude reboot na Hot Resume start de laatst gebouwde fysieke ROM;
- incompatibele closure/static-storagewijzigingen mogen als IDE-fout worden
  gerapporteerd, maar niet als impliciete reboot, rollback of silent fallback.

Relevante reeds bestaande regressielessen:

- `Ctrl+Shift+S` is de echte route; er bestaat geen aparte “unsaved
  Hot-Resume-route” die als vervanging getest mag worden.
- Een eerdere bug pakte de eerste sourcewijziging wel op en negeerde de tweede
  en volgende. Tests moeten daarom minimaal twee **verschillende** opeenvolgende
  saves/builds uitvoeren en daarna cold-bootverificatie doen.
- De bron van waarheid is het werkelijk opgeslagen/door de IDE aangepaste
  sourcebestand, niet een testinterne string die los van de editorflow aan een
  linker wordt gevoerd.
- `print()` hoort via de gewone platformlogging zowel de moderne IDE-terminal
  als de browser/hostconsole te bereiken. Een eerder voorgestelde
  `sendBeacon('/__bmsx__/log')`-serverroute was fout en is niet het gewenste
  ontwerp.
- Voeg tijdelijke `print()`-statements aan een speciale testcart of cartlib toe
  wanneer dat voor debugging helpt, maar pin geen onaf spel als golden fixture.

### Bestaande echte IDE-flowtest

`tests/ide/hot_resume_entry_edit.idetest.js`:

- draait een speciale testcart;
- voert twee opeenvolgende edits uit;
- wijzigt cart entry, een cartmodule en systemcode;
- controleert live heapobjectidentiteit;
- controleert `init`- en `new_game`-counts;
- controleert mediarevisioncounts;
- controleert dat data-only slot 1 niet wordt vervangen;
- reboot en controleert dat de tweede fysieke revisie cold-booted.

Package-script:

```bash
npm run test:hot-resume
```

Maak voor nieuwe Hot-Resume-regressies niet alleen een nep-unitflow met
`installRevision(1)`. Voeg waar de bug source-save/build/install betreft bewijs
toe aan de werkelijke IDE-flow. Gerichte CPU/format-unittests blijven wel
geschikt voor pure fysieke CPU-contracten.

## 11. Validatie die vóór de laatste tussenwijziging groen was

Op een eerdere checkpoint van dezelfde grote werkboom was het volgende groen.
Dit is historische evidence, geen bewijs voor de huidige laatste regels:

### TypeScript/rompacker/Lua

```bash
npx tsc --noEmit --project tsconfig.json
npm run test:rompacker
npm run test:lua
```

Resultaten:

- rompacker: `87/87`;
- Lua/TS: `503 pass`, `1 skip`, `0 fail` (`504` totaal).

### C++

Volledige build plus CTest:

```text
23/23 tests passed
```

### Architectuur/parity

```bash
npm run audit:core-parity
npm run audit:architecture-boundaries:strict
git diff --check
```

Boundary audit rapporteerde `0 issues`.

### Hot Resume

```bash
npm run test:hot-resume
```

Bewijsde twee opeenvolgende echte IDE-revisies met 27 assertions.

De heap-Hot-Resume-test draaide acht resumes en hield tracked object-, string-,
code-, function-, constant-, module- en globalcounts stabiel; 39 assertions.

### Cartridge en runtime

```bash
npm run test:cartridge-conformance
```

Resultaat:

```text
READY|STEP1|STEP1
```

### Rendering en screenshots

```bash
npm run test:render-parity
npm run test:bare-metal-frame-scan
npm run test:pietious-scanout-headless
```

Resultaten:

- `renderhwtest`: 3 screenshots exact tussen TS software, C++ software en GLES2;
- `bare_metal_cart`: 146 screenshots exact tussen dezelfde drie routes;
- bare-metal framescan: 146 frames geslaagd;
- `pietious` headless scanout geslaagd;
- `bottomActivePixels: 3332`.

De montage en `tests/carts/pietious/screenshots/frame_00621.png` zijn visueel
gecontroleerd; er was geen zichtbare tile-regressie op dat checkpoint.

## 12. Vereiste hervalidatie voor iedere gesalvagede oplossing

Begin klein, maar eindig volledig.

### Gerichte snelle set

```bash
npx tsc --noEmit --project tsconfig.json
npx tsx --test --import ./tests/lua/test_setup.ts \
  tests/lua/cpu_interrupt_state.test.ts \
  tests/lua/system_controller.test.ts \
  tests/lua/const_function_module.test.ts
npm run test:rompacker
npm run audit:architecture-boundaries:strict
git diff --check
```

### Volledige vereiste set

```bash
npm run test:lua
npm run test:rompacker
npm run test:hot-resume
npm run test:cartridge-conformance
npm run audit:core-parity
npm run audit:architecture-boundaries:strict
```

Bouw en draai daarna de volledige C++ CTest-suite met de bestaande
projectcommands/CMake-builddir.

Bij wijzigingen aan CPU/image/save-state/runtime:

```bash
npm run test:render-parity
npm run test:bare-metal-frame-scan
npm run test:pietious-scanout-headless
```

Inspecteer screenshots daadwerkelijk; rapporteer geen “render parity” op basis
van alleen een build.

## 13. Aanbevolen overnameroute voor de volgende LLM

Dit is geen voorgeschreven classdiagram. Het is een volgorde die voorkomt dat
Hot Resume opnieuw de hardwarearchitectuur bepaalt.

### Fase A — maak eerst een expliciete fysieke-kerninventaris

Zonder productiecode te wijzigen:

1. Lees de volledige diff van:
   - TS/C++ CPU;
   - BLua32 image decode;
   - Memory/CartridgeController;
   - Runtime boot;
   - save-state;
   - firmwareboot en `CP0.EXEC`.
2. Label ieder veld/API als:
   - fysieke machine-/VM-toestand;
   - afgeleide emulatorcache;
   - debugger/toolingmetadata;
   - Hot-Resume-specifieke state.
3. Markeer alle dependencies van CPU/runtime naar:
   - symbols;
   - source paths/ranges;
   - revision maps;
   - linkerbaseline;
   - IDE source registries.
4. Vergelijk deze grens met een volwassen emulator + debugger, niet met een
   game-engine hot-reloadfacade.
5. Leg het minimale fysieke CPU-contract eerst aan de gebruiker voor.

### Fase B — voltooi de fysieke kern zonder Hot Resume

Acceptatiecriteria:

- cold boot werkt voor system + slot 0/slot 1;
- firmware kiest de cart;
- raw physical addresses zijn voldoende;
- TS/C++ parity;
- save/restore tegen huidige media;
- debugging kan desnoods via een afzonderlijke laag ruwe PC/framegegevens
  consumeren;
- CPU kent geen `Revision`, previous source, baseline of IDE lineage;
- geen oud executable hostbuffer is eigenaar van framefetch.

Verwijder Hot Resume niet. Isoleer alleen zijn vervuiling terwijl de bestaande
IDE-test als vereiste blijft staan voor Fase C.

### Fase C — ontwerp Hot Resume als debugger/toolingoperatie

Eerst reference study, daarna een smal ontwerp.

Eigendom:

- IDE/tooling bewaart vorige sources, symbols, linkerlayout en lineage;
- linker/tooling bouwt de nieuwe fysieke ROM-tail;
- ROM-owner installeert nieuwe media;
- debugger/tooling bepaalt welke fysieke continuation-PC's coherent kunnen
  worden verplaatst;
- de CPU biedt hoogstens generieke emulator/debuggerprimitieven die ook zonder
  source revision betekenis hebben.

Een generieke debuggerprimitive mag bijvoorbeeld ruwe machine-/VM-frame- of
registerstate benaderen wanneer dat overeenkomt met serieuze emulatorpraktijk.
Noem zo'n API niet `applyRevision`, laat hem geen source maps interpreteren en
laat hem geen linkerobjecten bezitten.

Bewijs daarna:

- echte IDE save/build/install-flow;
- meerdere opeenvolgende edits;
- active exception/RFE/NMI;
- system-only wijziging;
- combined system+cart wijziging;
- heap/global/RAM/device/audio behoud.

### Fase D — verplaats toolingdirectories later

Pas na functionele/architecturale afronding kan tooling uit de historische
`machine/`-boom worden verplaatst. Meng die repo-brede move niet met de
hardwarefix.

## 14. Concrete no-go-oplossingen

De volgende LLM moet deze routes niet opnieuw proberen:

1. `Revision` hernoemen naar `Generation`, `Patch`, `Update` of `MediaDelta`
   terwijl CPU dezelfde source-maplogica houdt.
2. Een nette wrapper/class rond `applyExecutableMediaRevision`.
3. Een lokale `relocatedPc`-helper in CPU, Runtime of featurecode.
4. `previous`/baseline in CPU of Runtime stoppen.
5. Een oud imagebuffer aan frames laten hangen en het “decoded cache” noemen.
6. RFE een fallback geven wanneer EPC niet meer bij de nieuwe functie past.
7. Hot Resume vervangen door reboot/rebuild.
8. Heap/RAM/devices capturen en terugzetten als pseudo-Hot-Resume-transactie.
9. Debugging verwijderen of `getDebugRange()` altijd leeg laten.
10. Symbols in release-ROM embedden om ownership eenvoudiger te maken.
11. Beide carts host-side samenlinken.
12. De tweede cart naar RAM kopiëren.
13. Whole-ROM decompressie/normalisatie terugbrengen.
14. Een runtime linker in TS of C++ introduceren.
15. Source `path` of `protoIndex` opnieuw als CPU-executionidentiteit gebruiken.
16. Bestaande carts als vaste golden Hot-Resume-fixture gebruiken.
17. Alleen een unit-test schrijven voor een bug in de echte IDE save/buildflow.
18. Problemen afvangen met `null!`, `?? null`, truthy/undefined-normalisatie of
    defensieve fallbacklagen.

## 15. Lessons learned

### 15.1 Begin niet bij Hot Resume

De grootste fout van deze poging was dat de fysieke BLua32-refactor en Hot
Resume tegelijk werden ontworpen. Daardoor bepaalde authoringtooling opnieuw
de CPU-representatie.

Correcte volgorde:

1. fysieke hardware-/VM-kern;
2. generieke emulator-debuggergrens;
3. IDE Hot Resume daarbovenop.

### 15.2 “Het werkt” is niet hetzelfde als “het is een emulator”

De eerdere Hot-Resume-tests konden groen zijn terwijl:

- CPU source revisions kende;
- frames oude hostbuffers uitvoerden;
- een actieve cart naar oude firmware bleef wijzen;
- EPC/NMI-PC's stale bleven.

Functioneel bewijs en architectuurbewijs zijn beide nodig.

### 15.3 Afgeleide caches mogen niet de fysieke eigenaar worden

Decoded pages en function indexes zijn goed voor performance. Het gaat mis
wanneer een frame door zo'n cache aan oude ROM-bytes wordt vastgepind.

De bron van waarheid blijft fysieke media + ruwe machine-/VM-state.

### 15.4 Iedere fysieke PC heeft een eigenaar

Niet alleen `frame.pc`:

- child `callSitePc` hoort bij de caller;
- EPC hoort bij de onderbroken framecontext;
- NMI-return-EPC hoort bij de voorafgaande exceptioncontext;
- debug `lastPc` hoort bij het topframe.

Verplaats of interpreteer deze waarden nooit los van hun image/slot/context.

### 15.5 Een slot is geen namespace

Beide carts delen dezelfde fysieke aperture. Slotselectie is een bussignaal en
instruction-execution latch, geen tweede hostadresruimte en geen padprefix.

### 15.6 Debugmetadata is geen executable identiteit

`path` en `protoIndex` zijn bruikbaar voor compiler/debugger/tooling, maar een
CPU voert fysieke function records en PC's uit. Maak debugidentiteit nooit de
runtime-identiteit.

### 15.7 Geen lokale quick fix voor een ownershipfout

De afgewezen `relocatedPc` was op zichzelf klein en testbaar, maar stond bij de
verkeerde eigenaar. Een elegante helper kan nog steeds architecturaal fout zijn.

### 15.8 Een groen testgetal kan scope missen

De echte bugs kwamen uit:

- contextvrije architecture audits;
- cross-image tests;
- system-only redenering;
- inspectie van exacte state-eigenaars.

Voeg tests toe die de werkelijke grens bewijzen, niet tests die de huidige
implementatievorm nabootsen.

### 15.9 Houd TS/C++ en debug/release tegelijk in beeld

Een TS-only convenience kan ongemerkt hardwaresemantiek worden. Een debug-ROM
kan hostmetadata verbergen die release niet bezit. Controleer daarom steeds:

- TS versus C++;
- debug versus release;
- cold boot versus Hot Resume;
- slot 0 versus slot 1;
- save versus restore;
- system-only versus combined updates.

### 15.10 Directorynamen zijn geen architectuur

`machine/ts/rompack/tooling` is tooling ondanks het pad. Verplaats later, maar
laat het huidige slechte pad geen excuus zijn om toolinggedrag in CPU/Runtime
te accepteren.

## 16. Documentatie die opnieuw moet worden gecorrigeerd

`docs/architecture.md` beschrijft momenteel delen van de nog afgewezen
Hot-Resume-implementatie als afgerond contract, waaronder retained old
development-tail bytes en CPU continuation relocation.

Corrigeer dit pas nadat de echte ownergrens is ontworpen. Tot die tijd:

- de fysieke ROM/BLua32/dual-slotsecties zijn richtinggevend;
- de Hot-Resume-paragrafen rond de huidige CPU revisionroute zijn geen
  betrouwbare eindwaarheid;
- `docs/open_architecture_slices.md` parkeert terecht:

  ```text
  IDE-HR-01 — De fysieke BLua32-kern is afgerond; verplaats dan
  linker-baselines, revisiesymbolen en PC-relocatie volledig naar
  IDE/debugtooling zonder heap, globals, RAM, devices, audio of de bestaande
  herhaalde Hot-Resume-flow te verliezen.
  ```

De fysieke kern is door de aangetroffen runtime/toolingleaks nog niet bewezen
afgerond.

## 17. Slotinstructie aan de volgende LLM

Doe niet direct een grote refactor.

1. Lees dit document.
2. Lees de live diff en de drie ownergroepen volledig.
3. Bestudeer production emulator/debuggerreferenties.
4. Schrijf eerst een korte ownerinventaris en een minimalistisch plan.
5. Toets dat plan expliciet op:
   - echte emulator versus host-engine;
   - overengineering;
   - performance;
   - behoud van Hot Resume en debugging;
   - TS/C++ fysieke parity.
6. Laat het plan reviewen voordat je implementeert.
7. Salvage goede fysieke BLua32-wijzigingen gericht; ga niet uit van een
   alles-of-niets-revert.
8. Rapporteer altijd welke checkpoint werkelijk opnieuw is getest.

De kernles van deze mislukte laatste stap is eenvoudig:

> Los een IDE-revisieprobleem niet op door de fysieke CPU meer over IDE-revisies
> te leren.
