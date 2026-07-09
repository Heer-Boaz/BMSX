# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

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
