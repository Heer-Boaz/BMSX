# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

De gedetailleerde uitvoering en validatie-evidence voor de GX/PSX-replacement
blijft in `docs/gx_psx_replacement_workplan.tmp.md`. De secties hieronder zijn
de nog open architectuurgrenzen; een groene headless test of TS/C++ pixel parity
sluit zo'n grens niet automatisch tegen echte hardware of een accelerated
backend.

## Actuele zichtbare regressies na de GX-migratie

Status: open; deze regressies zijn niet opgelost door de huidige headless- en
pariteitsvalidatie en moeten als harde acceptatieblokkades blijven staan.

- De ontbrekende WebGPU-passes en de gesplitste-bundlemenuqueue zijn hersteld:
  terminal/IDE en quick menu delen nu een retained host-UI-publicatiegrens in
  TS/C++, WebGPU heeft een native overlay/menu-renderpad en de split-bundle
  headless integratie rendert beide weer. De live WebGPU-browseracceptatie
  blijft uitgesteld en houdt dit punt visueel open.
- De verticale `pietious`-compressie is in TS/C++ software, WebGL2, GLES2 en
  WebGPU hersteld door de geprogrammeerde actieve displayrange over het vaste
  hostdoel te schalen. Headless en GLES2/llvmpipe bereiken aantoonbaar de
  onderste hostrijen; live WebGL2/WebGPU-acceptatie blijft uitgesteld. De
  producer emitteert sprites nu in oplopende effectieve z-volgorde, zodat hoge
  z als laatste door de painter-ordered GX-GPU wordt getekend. De bestaande
  componentbucket wordt rechtstreeks gesorteerd; de BIOS-sort scant een reeds
  gesorteerde bucket eenmaal en alloceert niet. Een headless gate bewijst zowel
  de eerste volgorde als een runtime-z-wijziging. De lange regressiescène raakt
  bovendien de concrete overlap tussen de speler op z=250 en een later
  gespawnde explosie op z=114.
- De transition- en combat-results-kleuren in `2025` kloppen niet meer: ze zijn
  donkerblauw tot bijna zwart in plaats van de lichtere Persona 3-blauwtint.
- Ondanks alle optimalisatiewerk zijn de performanceproblemen van de
  libretro-versie niet opgelost. Zelfs op een Intel Core Ultra 7 met een
  RTX 5070 Ti vertoont `bare_metal_cart` bizarre, zeer zware slowdown.

## Host-UI-publicatie en WebGPU-overlay live bewijzen

Status: implementatie afgerond; live WebGPU-presentatie blijft uitgesteld.

- `overlay_queue` is de enige retained publicatiegrens tussen host-UI-producers
  en renderbackends. Workbench en menu hebben afzonderlijke lanes, zodat de
  vaste overlay->menuvolgorde behouden blijft zonder commandkopie of
  per-frame-arrayallocatie.
- Geen TS/C++ backend leest de `HostOverlayMenu`-controller. De producer
  publiceert uitsluitend verwijzingen naar zijn bestaande kinds/refs/count;
  de pass-state neemt die drie waarden over en de backend consumeert alleen de
  pass-state.
- WebGPU rendert terminal, IDE en menu rechtstreeks bovenop de bestaande
  swapchainkleur met retained pipeline, atlas, bindgroep, uniforms en groeiende
  instancebuffers. Solid en atlasquads gaan in één geordende instanced draw.
- WebGL2 consumeert dezelfde centrale retained quadstream en uploadt per lane
  eenmaal floatdata en texture-kinddata in plaats van per UI-command te flushen.
- De echte split-bundle headless route bewijst terminalweergave en een menu met
  16 gepubliceerde commands; TS/C++ queuetests bewijzen pointer-/arrayidentiteit,
  consume en clear.

Nog te sluiten:

- Terminal, IDE en quick menu tijdens de expliciete browsersessie live tegen
  WebGPU en de WebGL2-fallback uitvoeren.

## GX actieve scanout naar het vaste hostdoel

Status: implementatie afgerond; live WebGL2/WebGPU-presentatie blijft
uitgesteld.

- De GP1 display-start-, horizontale-range-, verticale-range- en modewoorden
  blijven raw GPU-registerstate. De centrale gespiegeld TS/C++ renderregels
  leiden pas aan de backenddatapathgrens de actieve bronrechthoek af.
- TS/C++ software, WebGL2, GLES2 en WebGPU schalen die actieve rechthoek
  rechtstreeks over het vaste BMSX-doel. De oude PAL/NTSC-overscancanvaslaag
  die 192 actieve regels eerst in 256 timingregels plaatste en daarna naar 240
  hostregels verkleinde, bestaat niet meer.
- WebGL2/GLES2 decoderen de registerwoorden alleen wanneer een scanoutwoord
  wijzigt en sturen één afgeleide `vec4` plus de RGB24-latch naar de shader.
  WebGPU hergebruikt één retained uniformscratchbuffer; er is geen per-frame
  object-, array- of DTO-allocatie toegevoegd.
- Gespiegelde softwarevectors bewijzen non-zero display-start, X/Y-VRAM-wrap en
  dat zowel 192 als 240 actieve regels de laatste hostrij bereiken. De
  `pietious`-headless gate telt 4.275 actieve pixels in hostrijen 225--239; een
  GLES2/llvmpipe-run van dezelfde frame-620-timeline telt 4.245.

Nog te sluiten:

- Dezelfde `pietious`-scene tijdens de uitgestelde browsersessie live tegen
  WebGL2 en WebGPU controleren.
- Field-aware 480i-scanout is hiermee niet geclaimd. De huidige line-countlatch
  verdubbelt de actieve range, maar volledige fieldweave/-bobsemantiek blijft
  onderdeel van latere timing/displaypariteit.

## WebGPU/browser-presentatie live bewijzen

Status: open, maar uitgesteld tot een expliciete browsersessie. Niet tussendoor
starten wanneer de browser/GPU voor ander werk nodig is.

Open contract:

- WebGPU blijft de standaard accelerated browser-backend vóór WebGL2.
- `bare_metal_cart` en `2025` moeten met opeenvolgende live frames worden getest,
  zowel op WebGPU als op de WebGL2-fallback. Sparse of willekeurige screenshots
  bewijzen niet dat periodieke flashes, zwarte frames of half opgebouwde command
  streams weg zijn.
- WSL2 Edge met een zwarte swapchain/shared-image-uitvoer is geen bruikbare
  visuele WebGPU-validatie. De definitieve check moet op een browserpad gebeuren
  dat WebGPU werkelijk kan presenteren.
- Als het probleem nog bestaat, ligt ownership bij frame-publicatie,
  render-pass/resource-lifetime en backend-presentatie. Cart-math is niet de
  eigenaar.

Niet doen:

- Geen frames droppen, extra waits, fallback-black, post-quads verkleinen of een
  losse boolean-gate die alleen symptomen verbergt.
- Geen WebGPU verwijderen of WebGL2 opnieuw de standaard maken.
- Geen backend-specifieke capture/readback-ownership naar `GameView` of een
  algemene facade verplaatsen.

## GPUREAD en accelerated VRAM-to-CPU readback

Status: CPU-GPUREAD is in alle backends geïmplementeerd; GPUREAD-naar-RAM DMA en
live accelerated conformance staan nog open.

Het gekozen contract volgt de productiepatronen van DuckStation en MAME waar
GP0(C0h) eerst een transfercursor zet, GPUREAD telkens twee 16-bit pixels
uitgeeft, wrap per pixel toepast en een oneven laatste pixel met nul aanvult.
DuckStation synchroniseert vóór de transfer een hardware-backendread met alle
eerdere GPU-work. BMSX neemt die ordering over, maar niet DuckStations blijvende
CPU-VRAM-shadow: de backend levert uitsluitend het resultaat van de aangevraagde
transfer aan het device.

Geïmplementeerd contract:

- GPUREAD moet de inhoud lezen die door de echte backend-VRAM/render targets is
  geproduceerd, inclusief voorafgaande accelerated draws en copies.
- GP0(C0h) zet in de bestaande GX-commandbuffer een harde readbackfence. Eerdere
  commands worden tot en met die marker uitgevoerd; latere GP0-commands blijven
  achter de fence totdat de volledige transfer via GPUREAD is geconsumeerd. Een
  volgende C0-marker blijft daarbij als command in de FIFO staan en overschrijft
  de actieve requestlatches niet.
- De commandstream blijft read-only aan de renderkant. Een echte retained
  `GxGpuReadbackPort` bezit requestlatches, fencecount, completionfase en de
  vooraf gealloceerde 512K-pixelbuffer en de consumptiecursor/datapath; alleen
  die smalle hardwareport is schrijfbaar voor de backend. De GPU bezit de
  GPUREAD-latch en GPUSTAT en consumeert woorden via de port. Dit zijn
  hardwarebuffers en latches, geen proxy, host-DTO of tweede VRAM-representatie.
- De GX-pass van iedere backend handelt de request rechtstreeks af. TS/C++
  software kopiëren uit hun raw VRAM-owner. WebGL2/GLES2 en WebGPU voeren eerst
  een retained packpass uit die telkens twee logisch gewrapte 16-bit VRAM-pixels
  als vier little-endian RGBA8-bytes wegschrijft. WebGL2/GLES2 lezen dat packed
  target met één `readPixels` rechtstreeks in de exchangebuffer; WebGPU encodeert
  packpass en texture-to-buffer copy in dezelfde commandencoder/submission en
  publiceert completion pas na `mapAsync`. Er staat geen pixelpackloop op de CPU.
- GPUSTAT bit 27 wordt pas gezet wanneer de backendcompletion zichtbaar is en
  er woorden resteren. Bit 25 blijft daarvan afgeleid wanneer GP1 DMA-direction
  GPUREAD-to-CPU selecteert. Een te vroege CPU-read leest alleen de bestaande
  GPUREAD-latch en voltooit of verschuift de transfer niet.
- Iedere geldige read levert het lage pixelwoord eerst, daarna het hoge;
  transfer-X/Y wrappen per pixel over 1024x512 en een oneven laatste pixel vult
  de hoge helft met nul. Na het laatste woord blijft de laatste GPUREAD-latch
  staan en mag de commandprocessor voorbij de fence.
- Current-format save-state bewaart requestfase, fence, cursor, latch en alleen
  bij READY de voltooide transferpixels. SUBMITTED is backendinfrastructuur:
  capture schrijft die fase als de logische PENDING-request en de codec weigert
  SUBMITTED op de wire;
  TS-save capture wacht een reeds ingediende WebGPU-readback af voordat de codec
  encodeert. Een completion uit een oudere reset/restore-generatie controleert
  zijn token voordat hij resultaatbytes schrijft of de nieuwe fase publiceert.
- Het current-format codeccontract heeft in TS/C++ exact dezelfde harde 16 MiB
  wire-capaciteit; encode én decode falen bij overschrijding. Libretro meldt een
  vaste header + 16 MiB envelope. Iedere save capturet en encodeert eenmaal en
  schrijft header en payload rechtstreeks in de frontendbuffer; de resterende
  suffix wordt daar genuld zonder retained 16 MiB tussenbuffer of extra kopie.
- TS en C++ moeten hetzelfde cart-zichtbare command/status/read-contract houden,
  ook wanneer browser-GPU completion asynchroon is.
- Alle BMSX-owned request-, staging- en packbuffers, descriptors, bindgroepen en
  uniforms zijn backend/device-owned en retained. De door WebGPU vereiste
  `Promise` en typed mapped-range-view bestaan alleen op de browser-API-boundary;
  de view wordt met één bulkcopy geconsumeerd en is geen tweede resultbuffer.
- De exchange en codec bewaren dezelfde little-endian pixelbytes. Restore is een
  bulkcopy naar de retained buffer en doet geen pixel-voor-pixel u8/u16-conversie.

Nog te sluiten:

- De custom DMA-route moet `IO_GX_GPU_GP0 -> RAM` als dezelfde GPUREAD-consument
  gebruiken en pauzeren zolang bit 27 laag is; hij mag de latch dan niet als
  transferdata behandelen.
- De raw wrap/odd/fence/status/save-statevector draait exact in TS en C++
  software. Dezelfde vector moet tijdens de uitgestelde browsersessie live tegen
  WebGL2, GLES2 en WebGPU worden uitgevoerd.

Niet doen:

- Geen CPU-raster- of VRAM-shadow als source of truth voor WebGPU, WebGL2 of
  GLES2.
- Geen stale-data fallback, fictieve synchrone read of backend-private shortcut
  als publieke machine-semantiek.
- Geen GPUREAD-dispatch, completionpolling of backendresource-ownership in
  `GameView`; de bestaande GX backendpass is de uitvoerende owner.

## Exacte GX raster- en VRAM-pariteit

Status: open.

Triangle/quad fill is nu in alle actieve owners geïmplementeerd: TS/C++ software
gebruikt dezelfde integer top-left edge ownership en half-open bounds; WebGL2,
GLES2 en WebGPU verschuiven PSX rasterposities bij de vertex-transform naar de
native half-integer pixelcenters. De mirrored softwarevectors bewijzen winding,
right/bottom exclusion en een semitransparante quadseam die exact eenmaal
blendt. Live accelerated conformance blijft uitgesteld tot de expliciete
browsersessie en houdt dit onderdeel open.

De normale drawing-area/offset-datapath is nu eveneens gespiegeld: raw negatieve
vertices krijgen eerst E5, E3/E4 blijft inclusief aan de GPU-kant en wordt pas
bij raster/scissor naar half-open grenzen vertaald. Solid en textured rectangles
clippen op alle vier randen zonder UV te herbaseren. Rectangle/sprite origins
worden na `vertex + offset` opnieuw als signed 11-bit geïnterpreteerd in TS/C++
software, WebGL2, GLES2 en WebGPU. Fill blijft buiten drawing-area en E6-maskstate;
de WebGPU-afwijking daarin is verwijderd. Mirrored raw-VRAM vectors dekken deze
contracten; live accelerated bewijs blijft uitgesteld.

Polygon raster-bucket wrapping volgt nu eveneens dezelfde regel in alle actieve
owners. De primitive-size reject ziet eerst de onverkorte `vertex + E5`
coordinaten; pas daarna vertaalt de rasterstage een volledige geaccepteerde
triangle per as met één signed-11 periode wanneer de minimumcoordinaat onder
`-1024` ligt. Daardoor blijft `+1024` een geldige exclusieve edge en blijven
winding, interpolatie en quadseams intact zonder extra draw, vertexallocatie of
CPU-rasterwerk in accelerated backends. Dit sluit aan op de scanline/span-volgorde
in DuckStation en Mednafen. Mirrored TS/C++ softwarevectors dekken de positieve
`+1024` edge, negatieve X-bucket met direct16 texture-interpolatie en negatieve
Y-bucket met drawing-area clipping en Gouraud-interpolatie.

Textured polygons gebruiken nu eveneens één gemirrorde PSX-attribuutplane. De
TS/C++ softwareowners stappen U/V met 12 fractionele bits, de halve-texel seed
en de 20-bit accumulatorwrap uit de DuckStation/Mednafen-rasterdatapath in plaats
van een exacte barycentrische deling per pixel. WebGPU consumeert de raw plane
als native unsigned multiply/add/shift-datapath. WebGL2 en GLES2 verplaatsen de
coordinatenvermenigvuldiging uit de fragment-hot-path: hun gemirrorde vertexstage
interpoleert vijf radix-16 digits binnen de gegarandeerde `highp` precisierange,
waarna de fragmentstage alleen afrondt en carries doorgeeft. De eerdere keten
van gesplitste 20-bit fragmentvermenigvuldigingen, `floor` en `mod` bestaat dus
niet meer. Quads tekenen hun twee planes afzonderlijk en verversen read-VRAM
tussen beide triangles wanneer blend- of maskstate dat vereist. Rectangles
behouden hun bestaande 7-float direct-UV vertexpad. Raw polygon-UV's blijven in
diezelfde vertexstream de source-cachebounds leveren; alle plane- en
uniformscratch is backend-owned en wordt hergebruikt. Mirrored vectors bewijzen
de halve-texel tie, niet-integrale X/Y-gradienttruncatie, vertaalinvariantie en
dalende accumulatorwrap.

Texture-window, texture-page, packed-texel en CLUT-adressering volgen al dezelfde
raw rekenvolgorde in de actieve owners. Nieuwe gemirrorde softwarevectors zetten
die grens vast voor niet-aaneengesloten E2 U/V-bit replacement, direct16 X- en
Y-wrap, palette4-nibbleselectie over een page-edge en palette8-byteselectie met
horizontale CLUT-wrap op dezelfde VRAM-rij. Accelerated source-copy blijft de
logisch gewrapte page- en CLUT-regio's gebruiken; alleen het live draaien van
deze raw vectors tegen de drie accelerated backends staat nog open.

Mask-bit, semi-transparency, blending, dithering en final-store volgen nu ook als
commandvolgorde dezelfde PSX-datapath in alle owners. WebGL2/GLES2 nemen beide
E6-bits rechtstreeks op in de solid-batch identity; een check-mask-wijziging kan
dus niet meer verdwijnen wanneer semi-transparency de batch al read-VRAM maakt.
Read-VRAM solid quads tekenen bovendien net als software en textured quads hun
twee triangles op volgorde en verversen de destination snapshot ertussen. Dit
houdt concave, bow-tie en andere representabele overlap deterministisch zonder
CPU-pixels, per-command buffers of extra werk voor opaque quads. Gemirrorde raw
vectors zetten STP-gated textureblend, E6 set/check voor solid draws en
single-versus-double-hit quadpixels vast. De vier 5-bit blendmodes, dithermatrix
en gemaskerde upload/copy-datapaths waren al gemirrord; live accelerated bewijs
blijft open.

Lines en polylines volgen nu in alle backendowners dezelfde DDA-conventie.
TS/C++ software wrapt iedere emitted sample pas na de 32.32-stap naar signed
11-bit. WebGL2, GLES2 en WebGPU evalueren de equivalente gehele DDA in de
fragmentshader en rasteren alleen een conservatieve drie pixels brede GPU-strip;
de host emit geen lijnpixels. Fixed-12 Gouraud, beide endpoints, size rejection
per segment en dubbele polyline-joints zijn gespiegeld. WebGPU splitst
overlappende read-VRAM-segmentbatches zodat het tweede jointfragment de eerste
write ziet. Mirrored softwarevectors bewijzen de oracle; accelerated live bewijs
blijft uitgesteld.

Nog te sluiten:

- Dezelfde triangle/quad vectors live tegen WebGL2, GLES2 en WebGPU uitvoeren.
- De fixed-point polygon-UV grensvector live tegen WebGL2, GLES2 en WebGPU
  uitvoeren.
- Live accelerated line/polyline-DDA, wrap, Gouraud en double-joint conformance.
- De verticale Gouraud-tie waar DuckStation `x0 >= x1` en Mednafen `x0 > x1`
  gebruikt tegen hardware beslissen; alle BMSX-backends volgen nu bewust de
  bestaande DuckStation/softwareconventie.
- Een expliciete PSX-hardwareversiekeuze voor 10-bit drawing-area-Y tegenover
  de huidige 512 VRAM-rijen.
- De drawing-area/offset/clipping-vectors live tegen WebGL2, GLES2 en WebGPU.
- De texture-window/page/packed-texel/CLUT-vectors live tegen WebGL2, GLES2 en
  WebGPU uitvoeren.
- De mask/STP/blend/dither/store- en read-VRAM-quadvectors live tegen WebGL2,
  GLES2 en WebGPU uitvoeren.
- Readback-zichtbare VRAM-inhoud na accelerated draws, fills en copies.

Richting:

- Leg kleine hardwaregerichte conformance vectors vast en draai dezelfde vectors
  tegen TS software, C++ software en de accelerated backends.
- TS/C++ pixel parity is een regressiepoort tussen onze implementaties, niet op
  zichzelf bewijs van echte PSX-pariteit.
- Fix decode/raster/storegedrag bij de GPU-owner; niet met cart-compensatie of
  backend-specifieke kleurcorrecties.

## Accelerated framebuffer-feedback performance

Status: root cause gemeten; ownerfix open.

Een capture-vrije 1100-frame libretro/GLES2-run is nu lang genoeg om de echte
`bare_metal_cart`-slowdownscenes te bereiken. De eerdere korte meting miste die.
Op llvmpipe meet de baseline 2,85 ms met vijf framebuffercopies per frame;
Tera-Flare 12,24 ms met gemiddeld 70 copies en de particle-scene 14,20 ms met
gemiddeld 72 en maximaal 147 copies. Een representatief particleframe besteedt
21,5 ms aan copies tegenover 2,1 ms aan draws. `glReadPixels` draait daar niet.

De ziekte zit in alle accelerated owners: destination-read primitives verversen
per command/triangle een VRAM-sampletexture (`glCopyTexSubImage2D` in GLES2 en
WebGL2, `copyTextureToTexture` in WebGPU). Losse semi-transparante particlelines
en read-VRAM textured quads maken de kosten daardoor O(primitives), terwijl ook
uniform- en vertexuploads per klein command blijven terugkomen.

Open contract:

- GLES2 moet, waar de concrete context dat bezit, raw destinationwoorden via
  framebuffer-fetch/texture-barrier consumeren en alleen op echte
  dependencygrenzen synchroniseren. Capabilitykeuze hoort in de concrete
  backend, niet in cartcode of een algemene facade.
- Alle accelerated backends moeten retained line/solid/textured streams over
  opeenvolgende compatibele GP0-commands gebruiken en alleen flushen op een
  pipeline- of read-after-writegrens.
- Source sampling krijgt afzonderlijke retained valid/dirty coverage; wisselende
  UV-rects mogen statische atlasdelen niet telkens volledig kopiëren.
- Een niet-overlappende contiguous VRAM-copy is één quad; rij- of gesplitste
  paden zijn alleen voor echte overlap, wrap of maskdependencies.
- Geen universele RGBA8 fixed-function-blendshortcut: tussenliggende sub-5-bit
  resten veranderen chained PSX-blends. Een alternatief moet raw 5-bit stores,
  vier blendmodes, STP, maskbits en opeenvolgende overlap tegen VRAM-woorden
  bewijzen.

Acceptatiepoort:

- Meet afzonderlijk baseline 100--139, flare 274--399, particles 404--529,
  echo 664--759 en morph 864--979; de particle-scene moet in de run zitten.
- Normale destinationcopies in particles gaan naar nul; sourcecopies volgen
  dirty coverage in plaats van primitivecount. Geen `glFinish` of per-frame
  `readPixels` als meet- of synchronisatieworkaround.
- Raw-VRAM parity omvat alle vier blendmodes, chained blends, STP, E6 set/check,
  overlappende lijnen/rectangles en concave/bow-tie quads.

## VDP/RPU uit actieve machine en presentatie verwijderen

Status: afgerond. GX is de enige cart graphics route en bezit GPU-registers,
commandbuffers, de vaste 1 MiB VRAM, scanout en save-state in beide runtimes.
De oude VDP/RPU- en IMGDEC-devices zijn uit de machine verwijderd.

Afgerond:

- alle actieve presentation registrations en machine-output routes zijn
  geïnventariseerd;
- de nog intern geproduceerde RPU-frameoutput wordt niet meer naar `GameView`
  gekopieerd of door een backend uitgevoerd;
- de verweesde host-side XF/LPU/MFU/JTU transform-, lighting-, fog- en
  frame-shared state plus de nooit ingeschakelde axis-gizmo/scene-code zijn
  verwijderd uit beide runtimes;
- output-quantization is host-presentatiestate en wordt niet meer via VDP-MMIO,
  VOUT of een VDP-view-snapshot gestuurd;
- de workbench-overlay bezit nu zelf zijn opaque basisvlak via de bestaande
  rect-pool; de oude `framebuffer_2d`-passes en `VdpFrameBufferTextures` zijn in
  TS en C++ verwijderd;
- geen enkele host-presentatieroute consumeert nog VDP-, VOUT- of
  framebuffer-output;
- de laatste actieve texture-aperturegebruiker is verwijderd: de ROM-producer
  encodeert nu voor alle direct16- en palette4-atlassen native GP0-uploadwords,
  waarna DMA de ROM-stream rechtstreeks aan GX GP0 levert. Runtime PNG-decode,
  mapped RGBA-staging en `gx_load_atlas` zijn uit BIOS en carts verdwenen.

Texture-residency boundary resolved for the migrated carts:

- `pietious` gebruikt een compacte native 4-bpp atlas plus CLUT en past daarmee
  bij een expliciete PSX-VRAM-residencyvorm;
- `2025` behandelt de ROM-atlas niet langer als universele runtime-eenheid:
  ieder actief full-screen direct16-achtergrondbeeld heeft een eigen producer-
  owned bank, de gelijktijdig gebruikte combatsprites delen een expliciete bank
  en het opaque all-outscherm heeft zijn eigen transitionbank. Daardoor uploadt
  een sceneovergang alleen de actuele werkset in plaats van een toevallig door
  de auto-packer samengestelde multi-backgroundatlas. De actieve background-
  uploads dalen daarmee van 718.812--896.976 bytes naar 155.872--199.224 bytes;
- de direct16-producent weigert brongeometrie die door de vaste PSX-VRAM-
  plaatsing over andere texturedata heen of buiten VRAM zou schrijven;
- een toekomstige cart met meerdere onafhankelijk wisselende texturewerksets
  moet vaste VRAM-page/CLUT-slots bij de GPU-residencyowner toevoegen. Bouw zo'n
  generieke cache niet speculatief en maak geen nieuwe atlas-swapwrapper.

- de residual staging-, texture- en framebuffer-apertures, VDP scheduler- en
  VBlank-hooks, registers, readback, save-state, tests en mirrored device trees
  zijn verwijderd;
- IMGDEC en zijn runtime decoder, DMA-imagepad en native `stb_image`-dependency
  zijn verwijderd. De ROM-producent blijft de enige atlas-codecgrens;
- MMIO, IRQ en scheduler service-id's zijn compact gemaakt. Er zijn geen
  compatibility-gaten of lege devicefacades behouden;
- DMA heeft één retained GP0/RAM-queue en één bandbreedtelatch; beëindigde work
  lekt geen carry of budget naar een volgende transfer.

Resterend graphicswerk staat bij de GX-pariteitsslices hierboven: met name
GPUREAD/accelerated readback en live accelerated conformance zodra echte
browser/GPU-runs weer beschikbaar zijn.

Niet doen:

- Geen compatibility shim, dual-write of verborgen fallback waarmee beide
  architecturen permanent actief blijven.

## GX software-rasterizer op low-end libretro hardware

Status: parkeren. Niet oppakken vóór de SNES-mini/hardware-focus opnieuw actueel
is.

Context:

- De huidige GX/PSX software-backend is op desktop/libretro-headless weer ruim
  boven realtime voor `bare_metal_cart`, ook in de zware particles/echo scènes.
- Dat bewijst geen Miyoo/Miyoo Mini-class target. Een low-end ARM handheld die
  MAME ondersteunt kan nog steeds een orde trager zijn voor onze algemene,
  branchy GX software-rasterizer.
- "MAME draait erop" is geen voldoende prestatiecontract: zulke apparaten draaien
  vaak oude/lichte MAME-cores en workloads die niet lijken op PSX-achtige
  textured/semi-transparent triangle overdraw met VRAM scanout/present.
- De emulator draaide eerder op SNES-mini-achtige hardware, maar dat was in het
  oude VDP-tijdperk. GX/PSX replacement moet opnieuw op targethardware bewezen
  worden.

Richting wanneer dit later wel wordt opgepakt:

- Eerst meten op echte targethardware of een representatieve ARM/libretro build;
  desktop/WSL extrapolatie is alleen richtinggevend.
- Eigenaar blijft de C++ GX software backend/rasterizer, niet cart-math.
- Verwachte optimalisatiegebieden: echte scanline/span rasterization in plaats
  van bounding-box pixel walks, gespecialiseerde flat/textured/raw/semi-trans
  paths, minder divides in inner loops, correcte dirty/tile scanout of present
  waar dat bij het hardwaremodel past.
- Geen workarounds zoals frames droppen, post-quads verkleinen, fallback black,
  CPU-side accelerated VRAM shadows, of cart-side scene-afzwakking als
  prestatieoplossing.

Voorlopige prioriteit:

1. SNES-mini/libretro hardware weer als ondersteund doel herbevestigen.
2. Pas daarna low-end handheld targets zoals Miyoo-class apparaten beoordelen.
