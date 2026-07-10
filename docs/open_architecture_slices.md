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

Nog te sluiten:

- Dezelfde triangle/quad vectors live tegen WebGL2, GLES2 en WebGPU uitvoeren.
- Resterende rectangle-, line- en polyline-regels, met name accelerated
  PSX-DDA-linecoverage en polyline-segmenten.
- Raster-stage signed-11 wrapping voor lines en polygons na drawing offset;
  vertices vooraf trunceren is niet equivalent aan het hardwaregedrag.
- Een expliciete PSX-hardwareversiekeuze voor 10-bit drawing-area-Y tegenover
  de huidige 512 VRAM-rijen.
- De drawing-area/offset/clipping-vectors live tegen WebGL2, GLES2 en WebGPU.
- Texture window, texture-page en CLUT-randen.
- Mask-bit, blend, dither, semi-transparency en storegedrag.
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
