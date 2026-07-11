# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

De gedetailleerde uitvoering en validatie-evidence voor de GX/PSX-replacement
blijft in `docs/gx_psx_replacement_workplan.tmp.md`. De secties hieronder zijn
de nog open architectuurgrenzen; een groene headless test of TS/C++ pixel parity
sluit zo'n grens niet automatisch tegen echte hardware of een accelerated
backend.

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

## C++ GX software-rasterizer hotspots

Status: open. Eerst profileren op de echte libretro/software-path; niet
optimaliseren op basis van vermoedens.

Open contract:

- Transparante driehoeken, particles en overdraw mogen op een krachtige machine
  geen zichtbare slowdown of frametime-spikes veroorzaken, ook als het gemiddelde
  nog boven realtime ligt.
- Waarschijnlijke eigenaren zijn de C++ triangle/span- en blend-inner loops,
  command iteration en VRAM/cache-invalidatie. De meting moet aanwijzen welke
  datapath werkelijk tijd kost.
- Optimalisaties moeten PSX-rastergedrag behouden en TS/C++ conformance niet
  vervangen door een snellere afwijkende renderer.

Niet doen:

- Geen cart-scenes afzwakken, particles reduceren, transparantie uitschakelen of
  frames overslaan als performance-oplossing.
- Geen hot-path tabellen/objecten, herhaalde decode, O(n)-invalidatie of algemene
  wrapperlagen toevoegen.

## GPUREAD en accelerated VRAM-to-CPU readback

Status: open ontwerpbesluit vóór implementatie.

Open contract:

- GPUREAD moet de inhoud lezen die door de echte backend-VRAM/render targets is
  geproduceerd, inclusief voorafgaande accelerated draws en copies.
- GP0 ordering, transfer-cursor, completion en CPU-zichtbaarheid moeten expliciet
  onderdeel van het devicecontract zijn. Een read mag een nog niet afgeronde GPU
  submit niet stilzwijgend passeren.
- TS en C++ moeten hetzelfde cart-zichtbare command/status/read-contract houden,
  ook wanneer browser-GPU completion asynchroon is.

Niet doen:

- Geen CPU-raster- of VRAM-shadow als source of truth voor WebGPU, WebGL2 of
  GLES2.
- Geen stale-data fallback, fictieve synchrone read of backend-private shortcut
  als publieke machine-semantiek.

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

## Volledige GTE-pariteitsaudit

Status: open.

Nog te sluiten:

- Audit alle geïmplementeerde opcodes tegen een serieuze PSX-referentie.
- Flags, saturation, divide overflow, MAC/IR-gedrag en ongebruikelijke
  registercombinaties.
- Exact dezelfde registerwoorden, flags en commandresultaten in TS en C++.

Richting:

- Gebruik raw register/opcode vectors en observeer echte uitvoerwoorden; voeg
  geen high-level geometry-semantiek aan de GTE toe.
- Weird maar representeerbare bits moeten deterministisch door de datapath lopen.
- Geen clamps, fallbacks of normalisatie buiten het gedocumenteerde
  hardwaregedrag.

## Resterende cartmigratie en bare-metal dekking

Status: open ondanks dat de bekende hoofdcarts nu een GX-pad hebben.

Nog te sluiten:

- Inventariseer alle actieve cart- en firmware-aanroepen naar de oude VDP/RPU-ABI
  en vervang de resterende graphics-programmering door GPU/GTE-programmering.
- Herstel de nog ontbrekende historische `bare_metal_cart`-dekking, vooral
  free-fly/side-camera en bredere mesh/post-pass-torture.
- Blijf met echte cart-owned GX residency werken; geen VDP stream shim, per-frame
  whole-atlas upload of CPU texture shadow voor accelerated backends.

Klaarcriterium:

- Geen actieve cartpresentatie is nog afhankelijk van VDP/RPU. Expliciete
  device-tests mogen het oude device alleen testen zolang dat device nog bestaat;
  ze zijn geen reden om de cart-ABI te behouden.

## VDP/RPU uit actieve machine en firmware verwijderen

Status: geblokkeerd op voltooide cartmigratie, GX-presentatie en voldoende
raster/readback-pariteit.

Volgorde:

1. Identificeer alle actieve presentation registrations, machine-output routes en
   cart-zichtbare ABI-aanroepen.
2. Laat GX de enige actieve graphics/presentation-owner worden.
3. Verwijder daarna oude firmware/system-paden en tests die uitsluitend de
   afgewezen renderer-descriptor-ABI beschermen.
4. Bewaar eventueel nuttige fantasy-hardware-ideeën alleen als documentatie voor
   latere GX-extensies; behoud daarvoor niet de oude ABI.

Niet doen:

- Niet verwijderen zolang carts of presentatie er werkelijk nog van afhangen.
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
