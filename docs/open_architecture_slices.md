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
- De concrete libretro/GLES-proceduregrens achter een groot deel van de
  Windows-slowdown is hersteld, maar de echte Windows-RetroArch-acceptatie
  blijft open. De frontend leverde zowel zijn framebuffergetter als zijn
  contextgebonden `get_proc_address`, maar BMSX gooide die tweede callback weg.
  Op Windows kon de backend daardoor nooit `glTextureBarrierNV` vinden en koos
  hij ongeacht de RTX 5070 Ti altijd de dure dependencycopyroute. De backend
  resolveert extensieprocedures nu rechtstreeks via de frontend die de context bezit.
  De WSL D3D12-GLES-route op die RTX exposeert `GL_NV_texture_barrier`, vraagt
  aantoonbaar exact `glTextureBarrierNV` via de libretrocallback en doorloopt de
  volledige slowdowntimeline zonder de gemelde zware vertraging. Alle 146
  captures blijven pixel-identiek. Pas een echte Windows-RetroArch-run mag deze
  zichtbare regressie definitief sluiten.

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

Status: CPU-GPUREAD en GPUREAD-naar-RAM DMA zijn geïmplementeerd; live
accelerated conformance staat nog open.

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
- De retained readbackport drijft dezelfde ready-to-send-toestand als een echte
  requestlijn naar de DMA-controller. Completion zet de lijn en plant een
  wachtende GPUREAD-sourcejob direct op de huidige machinecyclus. De laatste
  geldige woordread maakt hem laag; reset en restore publiceren rechtstreeks de
  bijbehorende portfase. Een lage lijn annuleert de DMA-service volledig. Er
  bestaat geen periodieke statuspoll, polltimer of tweede geserialiseerde
  readinesslatch.
- `IO_GX_GPU_GP0 -> RAM` is een woordgerichte device-to-memorydatapad in de
  bestaande custom DMA-owner. De sourcepoort blijft vast, iedere geldige mapped
  GP0-read schrijft één little-endian woord rechtstreeks naar de oplopende
  RAM-destination en alleen echte woorden verhogen remaining/written/budget.
  De 64-byte stagingbuffer van normale memory-sources wordt hiervoor niet
  gebruikt. Een langere job blijft BUSY na het laatste woord en hervat op een
  volgende echte C0-completion zonder de retained GPUREAD-latch te kopiëren.
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

- De raw wrap/odd/fence/status/save-state/DMA-vector draait exact in TS en C++
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

Status: concrete retained ownerfixes en de libretro-contextresolver zijn
afgerond; echte Windows-RetroArch- en live WebGL2/WebGPU-capabilityvalidatie
blijven open.

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

De eerste native GLES2-ownerfix is actief. Een context die exact
`GL_NV_texture_barrier` plus de procedure bezit, laat solid- en line-shaders het
attached raw-VRAM-texture op dezelfde pixel lezen en zet een texture barrier op
de bestaande overlapgrenzen. De bestaande copyroute blijft het concrete pad
voor contexts zonder die capability. In een steady particleframe daalt het
totale aantal sampletexturecopies daardoor van 147 naar 1; solid/line-
destinationcopies zijn nul. De volledige 1.030-frame timeline levert met en
zonder de capability 146 byte-identieke captures, inclusief particles, echo en
morph.

De libretrofrontend is daarbij de eigenaar van de GL-procedureresolver. BMSX
bewaarde voorheen alleen `get_current_framebuffer`; de GLES-backend probeerde
extensieprocedures zelf via `dlsym`/`eglGetProcAddress` te vinden en retourneerde
op niet-Unixplatforms altijd nul. Nu reist `get_proc_address` samen met de
framebuffergetter door de bestaande hardwarecontextgrens en gebruikt de backend
die resolver rechtstreeks. Een gerichte native regressie bewijst deze
callbackidentiteit. Op de WSL D3D12-route met de RTX 5070 Ti wordt daardoor de
exacte `glTextureBarrierNV`-procedure opgevraagd. Drie capturevrije runs van de
volledige 1.020-frame timeline kosten 6,48, 6,83 en 6,65 seconden wall time; een
capture-run passeert alle slowdownvensters en alle 146 beelden zijn exact gelijk
aan de voorafgaande native-barrierrun.

`GL_EXT_shader_framebuffer_fetch` is onderzocht maar niet blind als tweede pad
toegevoegd. De lokale Mesa 25.2.8-llvmpipe adverteert de extensie maar geeft bij
iedere levende `gl_LastFragData`-read nul output; upstream Mesa heeft precies
die color-fbfetchfout pas in maart 2026 gerepareerd. ANGLE kan de coherent-
extensiestring bovendien exposen terwijl het zelf documenteert dat de emulatie
alleen tussen drawcalls ordent en self-overlap binnen één draw niet garandeert.
Daarom staan er geen driverblacklist, runtimeprobe, shadertruc of onbewezen
fallback in BMSX. Deze capability wordt pas toegevoegd nadat de echte
Windowscontext haar live kan bewijzen.

Textured draws gebruiken datzelfde concrete barrierpad nu wanneer hun fysieke
page/CLUT-coverage niet met de geclipte destination overlapt. Dan leest de
shader source en destination rechtstreeks uit attached raw VRAM; tussen de
afzonderlijke polygontriangles staat opnieuw een barrier. Een aliassende page,
CLUT of texture window blijft op de sampletexture zodat de framebufferfeedback
niet buiten de `GL_NV_texture_barrier`-regels valt. Tera-Flare gaat daarmee van
gemiddeld 62,75 en maximaal 65 copies naar exact één retained-sourcecopy per
frame. In dat venster gebruiken gemiddeld 32 textured commands het barrierpad.

De sampletexture heeft nu in GLES2, WebGL2 en WebGPU ook retained dirty-
coverage in plaats van een cache van alleen de laatst aangevraagde page/CLUT-
rects. `vramTexture` blijft de autoriteit; init, clear en snapshotupload maken
de volledige shadow dirty, iedere raw-targetwrite markeert na de draw zijn
werkelijke geclipte bounds en een source- of destination-read synchroniseert
alleen als de aangevraagde coverage de retained dirty-unie raakt. De sync
kopieert dan die volledige unie en maakt haar clean. Daardoor blijven
ongewijzigde atlasdelen geldig wanneer opeenvolgende primitives andere UV-
rects gebruiken. De oude drie rectarrays, hashes en vier grove tilemaskwords
zijn uit alle drie owners verwijderd.

Op dezelfde meetvensters daalt de expliciete copyroute zonder texture barrier
naar drie copies in baseline, gemiddeld 62,75 en maximaal 65 in Tera-Flare, en
gemiddeld 40,43 en maximaal 94 in particles. Voor particles was dat gemiddeld
72 en maximaal 147; met de native barrier blijft het totaal één niet-
destinationcopy. De 1.030-frame barrier- en copyruns leveren onderling 146
pixel-identieke captures. Met CRT en noise uit is de retained-dirty-run ook op
alle 146 captures pixel-identiek aan de voorafgaande accelerated implementatie.

De WebGPU-owner submit nu bovendien de reeds encoded GP0-draws vóór een directe
`queue.writeTexture`-CPU-upload. Daardoor kan een latere raw- of transferupload
niet meer vóór oudere draws op de queue komen en kan een volgende masked upload
de transfertexture niet overschrijven voordat de vorige transferdraw haar heeft
gelezen.

VRAM-to-VRAM-transfer bouwt in GLES2, WebGL2 en WebGPU ook niet langer één
transferquad per rij. De backend loopt rechtstreeks over de fysieke X- en
Y-runs van source en destination en emitteert één rechthoekige quad tot de
eerstvolgende VRAM-rand. Een niet-wrappende copy is daardoor exact één quad;
een dubbel gewrapte copy blijft begrensd op maximaal drie bij drie quads. De
320x240 offscreen-copy die `bare_metal_cart` ieder frame presenteert daalt van
240 quads, 5.760 vertexfloats en 23.040 uploadbytes naar één quad, 24 floats en
96 bytes. Echte diagonale overlap behoudt de bestaande chunkgrenzen en E6
set/check blijft per pixel in de transferdatapath. Deze hot paths staan nu ook
expliciet onder de no-heap/no-GC-audit. De volledige 1.030-frame
GLES2/llvmpipe-run blijft op alle 146 deterministic raw captures byte-identiek
aan de voorafgaande implementatie. Vier afwisselende capturevrije A/B-runs van
die volledige timeline meten voor het oude rijpad gemiddeld 10,59 s user-CPU en
voor de rechthoekige runs 9,97 s: 5,9% minder over de hele run, niet alleen de
copy zelf.

Referencebasis: DuckStation kiest in
[`GPU_HW::CopyVRAM`](https://github.com/stenzek/duckstation/blob/ad7519d72c935b57b6a6e1c17f5fcba3c15783ff/src/core/gpu_hw.cpp#L3620-L3757)
eveneens één shadercopy voor mask/wrap, een directe texture-region-copy voor de
eenvoudige contiguous case en afzonderlijke chunks voor diagonale overlap.

De overblijvende commandprofiler liet daarna zien dat kleine lijncommands nog
steeds ieder hun eigen vertexupload, uniforms en draw kregen: 26 lijndraws in
baseline/echo, gemiddeld 96,63 en maximaal 97 in particles, en 32 in morph.
GLES2, WebGL2 en WebGPU houden opeenvolgende compatibele lijnen nu in dezelfde
retained vertexstream. Een statewissel, een ander primitieftype, volle
vertexbuffer of een echte read-VRAM-overlap flusht; interleaved line/solid-
volgorde wordt dus niet herschikt. De batchstate en scratchbuffers zijn retained
en staan samen met append/flush/execute onder de no-heap/no-GC-audit. Baseline
en echo dalen van 26 naar 3 lijndraws, flare van 24 naar 2, particles naar
gemiddeld 73,78 en maximaal 75, en morph van 32 naar 9. Het aantal geüploade
vertexbytes blijft gelijk, maar bufferuploads, uniformupdates en draws volgen nu
deze batchgrenzen in plaats van ieder GP0-lijncommand. Alle 146 deterministic
raw captures van de volledige GLES2-timeline blijven byte-identiek. Vier
afwisselende capturevrije llvmpipe-runs met één worker meten over de hele
timeline 6,70 tegenover 6,66 s CPU: vrijwel vlak, dus de bewezen driver-call-
reductie is niet de dominante llvmpipe-kost.

Dit volgt dezelfde grens als DuckStation
[`GPU_HW::PrepareDraw`/`FlushRender`](https://github.com/stenzek/duckstation/blob/ad7519d72c935b57b6a6e1c17f5fcba3c15783ff/src/core/gpu_hw.cpp#L3774-L4009):
vertices blijven retained totdat renderstate, buffercapaciteit of een echte
dependency een flush vereist.

De WebGPU-solidroute volgt nu eveneens die retained grens in plaats van per
GP0-command een uniformslot, vertexupload en renderpass te maken. Compatibele
fills, rectangles en polygonen delen één stream; drawing area, mask/dither,
interlace, blendstate, een ander primitieftype en een echte read-VRAM-overlap
blijven flushgrenzen. Een read-VRAM-quad blijft bewust twee geordende
triangledraws, omdat de tweede triangle het resultaat van de eerste kan lezen.
De scratch, batchstate en bounds zijn backend-retained en de volledige solid
append/flushroute staat onder de no-heap/no-GC-audit. Hiermee zijn solid en line
in alle accelerated owners retained; live WebGPU-validatie blijft onderdeel van
de reeds uitgestelde browsersessie, niet van de software/headless claim.

Textured polygonen en rectangles volgen diezelfde retained grens nu in GLES2,
WebGL2 en WebGPU. De affine UV-plane zit niet langer in per-triangle uniforms:
GLES2/WebGL2 dragen de carry-veilige 20-bit interpolanten in de vertexstream en
WebGPU draagt de raw base- en stepwords als flat `u32` vertexdata. De plane-
scratch, vertices, batchbounds en state zijn backend-retained; append, source-
dependencyanalyse, upload en flush staan onder de no-heap/no-GC-audit.

Een drawing-area-, drawmode-, texture-window-, CLUT-, raw/semi-transparency-,
mask-, dither- of interlacewissel blijft een batchgrens. Ook een texture/CLUT-
read uit een nog pending destination flusht eerst en synchroniseert daarna de
source opnieuw. Een command waarvan source en eigen destination aliasen blijft
op het geordende immediate pad. Opaque GLES2-batches lezen bewust de stabiele
sampletexture: anders kan een latere destination in dezelfde draw een eerdere
source raken. Alleen echte read-VRAM-batches lezen attached VRAM en houden per
triangle de noodzakelijke barrier/draw-volgorde. WebGL2 en WebGPU behouden op
diezelfde grens hun concrete dependencycopy.

De profiler bewijst daardoor driver-callreductie zonder de echte dependencies
weg te liegen. In baseline gaan 13 textured commands van 13 vertex/uniform-
uploads en 26 draws naar 8 uploads/draws. Tera-Flare gaat van 32 naar 3 uploads;
de 62--64 geordende triangledraws blijven staan omdat alle 32 quads echt
destination-read zijn. Echo gaat van 16 uploads/32 draws naar 9/14. Particles en
morph bevatten in hun stabiele venster geen textured commands. De native-
barrierroute en de geforceerde copyroute blijven over alle 146 captures van de
1.030-frame timeline byte-identiek aan de voorafgaande accelerated owner.

Dit volgt ook DuckStations retained `BatchVertex`/`PrepareDraw`-grens en zijn
[`DrawBarrier::Full`](https://github.com/stenzek/duckstation/blob/ad7519d72c935b57b6a6e1c17f5fcba3c15783ff/src/util/vulkan_device.cpp#L3628-L3646):
state en vertices worden eenmaal geüpload, terwijl echte shader-blendfeedback
per primitive geordend blijft. Vier afwisselende llvmpipe-runs met één worker
over de 982-frame capturevrije slowdown-timeline meten gemiddeld 6,37 naar
6,23 s user-CPU en 6,75 naar 6,56 s totale CPU: respectievelijk 2,2% en 2,9%
lager.

Bewaard contract en meetgedreven vervolg:

- GLES-contexts zonder texture barrier en de WebGL2/WebGPU-owners blijven op
  expliciete dependencycopies. Een geadverteerde framebuffer-fetchextensie is
  niet op zichzelf voldoende bewijs van een bruikbaar pad. Andere
  framebuffer-feedbackmogelijkheden zijn pas relevant als hun concrete backend
  en ordering live bewezen zijn; capabilitykeuze hoort niet in cartcode of een
  algemene facade.
- De huidige retained dirty-unie is correct maar kan bij ver uit elkaar liggende
  of wrappende writes grof worden. Alleen wanneer metingen dat als volgende
  bottleneck aanwijzen, wordt zij bounded fijnmaziger; cleanbits mogen dan pas
  verdwijnen nadat de volledige gerepresenteerde tile of rect is gekopieerd.
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

Resterend graphicswerk staat bij de GX-pariteitsslices hierboven: met name live
accelerated GPUREAD-conformance zodra echte browser/GPU-runs weer beschikbaar
zijn.

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
