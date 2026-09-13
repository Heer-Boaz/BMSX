# Scanoutmaat en host-presentatiemaat

Datum: 2026-09-13. Vergelijkingsbasis: `b2a1f85a7`.

## Reproductie en oorzaak

De bestaande ActionEffect-inspectieproef eindigt met rewind terwijl de IDE open
blijft. `requestRestoredPresentation` maakt de PCRTC-presentatie opnieuw actueel.
De oude presentatiecode zette daardoor het renderdoel van 384×288 terug naar
256×192, terwijl de IDE-layout en haar gepubliceerde commands nog 384×288 waren.
WebGL2/WebGPU verkleinden de tiny-glyphs en verloren texels. Software tekende
zonder die verkleining en kapte de rechter- en onderkant af: leesbaar was niet
hetzelfde als correct.

Dezelfde fout is met ongewijzigde productiecode van `36e9a1ca2` gereproduceerd.
De nieuwe gedeelde Studio-assertie faalt daar direct na de restore: layout en
presenter hebben verschillende afmetingen. Geen font-, atlas- of sourcefout.

## Referenties en afleiding

- [DuckStation `ImGuiManager`][duckstation] neemt UI-afmetingen bij initialisatie
  van de host-swapchain en actualiseert ze in `WindowResized`, niet vanuit een
  emulated-game-resolution. De host beheert de UI-presentatieruimte.
- Dear ImGui [OpenGL3][opengl] en [WebGPU][webgpu], versie 1.92.3, onderscheiden
  `DisplaySize` van framebufferafmetingen. Projectie en scissor gebruiken dezelfde
  expliciete relatie; een verkeerde targetmaat is geen atlascorrectie.

**BMSX-afleiding:** het product blijft zijn bestaande lage renderresoluties
gebruiken. Geen HiDPI-rewrite of nieuwe windowmanager. De presenter bewaart apart
de actuele scanoutmaat en de keuze om een vaste hostmaat te gebruiken. Eén owner
past backend, video-output en rendergraph aan wanneer de gekozen maat verandert.

## Owners en representatie

| Gegeven | TypeScript | C++ |
| --- | --- | --- |
| Actuele machine-outputmaat | `scanoutWidth`, `scanoutHeight`: number | dezelfde namen: i32 |
| Host kiest vaste maat | `fixedRenderTargetSize`: boolean | dezelfde naam: bool |
| Gekozen doelmaat | bestaande `viewportSize`, `canvasSize`, `offscreenCanvasSize` | bestaande Vec2-velden |

- `setScanoutSize` ontvangt de laatste outputmaat, ook wanneer de host een vaste
  maat gebruikt. PCRTC-revision, restore en reset blijven bij hun bestaande
  presentation-state-owner; de libretro-AV-synchronisatie gebruikt hetzelfde pad.
- `setFixedRenderTargetSize` kiest de hostmaat. Ook een gelijke afmeting verandert
  de sizing-keuze: zij is niet langer afhankelijk van latere scanoutwijzigingen.
- `useScanoutRenderTargetSize` volgt weer de **laatste** scanoutmaat. Het bewaart
  of herstelt geen vroegere maat. `CartEditor` heeft geen baseline-capture meer.
- De feitelijke `setRenderTargetSize` is private. De bestaande gelijkheidscheck
  voorkomt onnodig targetallocatie, hostlayout en graph-rebuild.
  De bestaande editor-activatietransitie begrenst ook layoutwerk; opnieuw een
  fout tonen in een al actieve IDE neemt het renderdoel niet opnieuw in bezit.

Callsites vóór de diff: TS `RenderPresentationState.presentFrame/reset`, C++
`RenderPresentationState.render/reset`, libretro `sync_current_av_info`, IDE
`enterRenderTargets/leaveRenderTargets`, en de bestaande graph-resizeproef.
Geen nieuwe CPU-, cartlib-, MMIO-, save-state- of glyph-datapathcallsite.
Drie scalarvelden per presenter; geen per-frame object, herstelcallback of
render-backend-specifieke oplossing. De ongeobserveerde game blijft de scanout
volgen. Software en accelerated backends krijgen dezelfde gekozen doelmaat.

## Bewijs

- TS-proef met echte presenter, softwarebackend, rendergraph en presentation-
  state: restore onder een vaste hostmaat, gewijzigde scanout terwijl die maat
  actief blijft, terugkeer naar de nieuwste maat, same-size admission en reset.
  Targetbuffer en graph-configuratierevision blijven behouden bij scanoutupdates
  die geen resize vereisen.
- Native `bmsx_video_presenter_tests` toetst dezelfde maat-/retentieovergangen
  met echte softwarebackend en rendergraph. Geen nieuwe native Studio.
- De gedeelde Studio-fixture controleert na iedere actieve IDE-frame de
  overeenkomst tussen layout en presenter, dus ook in bestaande workflows.
- De echte inspectieflow draait op software/WebGL2/WebGPU met Reboot, rebind-
  breakpoints, Hot Resume, compilefout en rewind. De driver vergelijkt de echte
  menubalkpixels tussen renderers, met hoogstens één 8-bit kleurstap verschil;
  geen vervangende glyphs of handgemaakt screenshot. In de gecontroleerde hele
  eindopnamen is WebGPU bytegelijk aan software; WebGL2 wijkt maximaal één
  kleurstap af. De tiny-font is op alle drie leesbaar en het hele werkvlak blijft
  zichtbaar.

Aanvullend gevalideerd: de volledige bestaande Studio-workflows en graph-
viewportproeven op alle drie browserrenderers; de native host-rewind en libretro-
rewind-ABI, native software/presenter en EGL/GLES2-overlayproeven; IDE-typecheck,
1761 geslaagde Lua-tests (1 bestaande skip), beide architectuur-/parity-audits
en de browser-Studio-productbuild. De tests-projecttypecheck heeft resterende
bestaande diagnostics; de oude ongetypeerde presenter-testdouble is vervangen
door het gedeelde harnas met de echte presenter.

Dit sluit de genoemde Studio-restorefout, niet alle mogelijke rendercombinaties.
De software-overlay consumeert nog 1:1-logische pixels; willekeurige publicaties
met een andere logical/targetverhouding zijn een afzonderlijke parity-gate. De
Studio kiest hier bewust dezelfde 384×288-layout en doelmaat.

[duckstation]: https://github.com/stenzek/duckstation/blob/master/src/util/imgui_manager.cpp
[opengl]: https://github.com/ocornut/imgui/blob/v1.92.3/backends/imgui_impl_opengl3.cpp
[webgpu]: https://github.com/ocornut/imgui/blob/v1.92.3/backends/imgui_impl_wgpu.cpp
