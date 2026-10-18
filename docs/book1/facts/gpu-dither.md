# Frozen GPU dither lesson facts — current software owners
Read-only scope: one GPU; current TS/C++ specification leaves, command producer, software rasterizer and VRAM writer. No scoped disagreement found. Chapter/facts files were locators only; no architecture document, reference PDF, external-hardware physics or inferred rates used.
Display routing is outside this sheet; reuse the separately verified current gpu_manual display recipe. Derived numbers below are arithmetic, not claimed execution evidence.
F01. GP0 draw-mode opcode is E1; mask-control opcode is E6. Source: `machine/ts/spec/gx/gp0.ts:1-6`. Mirror: `machine/cpp/spec/gx/gp0.h:8-13`.
F02. Dither is draw-mode bit9=0200H; draw-to-displayed-field is bit10=0400H; direct16 mode=2. Source: `machine/ts/spec/gx/gp0.ts:44-52`. Mirror: `machine/cpp/spec/gx/gp0.h:46-54`.
F03. Page X=(word AND 0FH)<<6; page Y derives bits 4/11; texture mode=(word>>7) AND 3. Thus 010AH selects page (640,0), direct16; 050AH/070AH keep that page/mode and bit10=1, with bit9 respectively 0/1. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:299-309`.
F04. Texture attribute is a UV word's high16; flat polygon T1 is packet word4; merge uses 09FFH, excluding dither bit9 and bit10. Thus T1=010AH preserves OFF/ON and draw-to-field. Source: `machine/ts/spec/gx/gp0.ts:103-112`.
F05. The GPU applies the polygon T1 merge to retained draw mode before emitting that polygon command. Source: `machine/ts/machine/devices/gx/gpu.ts:1237-1242`.
F06. Opcode bits0/1/2/3/4 mean raw/semitransparent/textured/quad/Gouraud; 2CH is flat-color, modulated, opaque textured quad; 64H is modulated opaque textured rectangle. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:79-97`.
F07. Quad packet has nine words: [2CA0647CH,XY0,00000000H,XY1,010A0000H,XY2,00000000H,XY3,00000000H]; triangles use (0,1,2), then (2,1,3). Source: `machine/ts/render/backend/software/gx_gpu_commands.ts:170-181`.
F08. Variable textured rectangle packet is [64A0647CH,XY,00000000H,00400060H] for 96x64; RGB/XY/UV/size are consumed in that order. Source: `machine/ts/render/backend/software/gx_gpu_commands.ts:212-224`.
F09. Supplied R/G/B are low/next/next bytes; A0647CH means (124,100,160). Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:57-67`.
F10. Texture-window word zero produces AND=FFH, OR=0 on both axes. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:321-335`.
F11. Equal zero UV vertex attributes yield zero derivatives and intercept 2048; extracting bits19:12 therefore remains zero. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:37-67`.
F12. Triangle U/V sample extraction takes (fixed>>12) AND FFH, confirming F11 constant (0,0). Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:537-541`.
F13. Direct16 fetch is raw VRAM at (pageX+windowedU,pageY+windowedV); F03/F10/F12 therefore fetch (640,0), whose initialized word below is 3527H. Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:127-139`.
F14. Per channel P=(T*C)>>4, then S=P+d; negative S returns0, otherwise min(S>>3,31). Arithmetic: 7*124=868>>4=54; 9*100=900>>4=56; 13*160=2080>>4=130. Source: `machine/ts/render/backend/software/gx_gpu_vram.ts:25-36`.
F15. Sample3527H decodes RGB5=(7,9,13), is nonzero, bit15=0; modulation uses F14, and blending requires command semitransparency AND fetched bit15. Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:157-171`.
F16. Dither uses final destination (x AND3,y AND3); matrix rows are [-4,0,-3,1], [2,-2,3,-1], [-3,1,-4,0], [3,-1,2,-2]. Source: `machine/ts/render/backend/software/gx_gpu_vram.ts:83-102`.
F17. A modulated textured polygon honors the enabled dither bit; raw texture does not. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:292-297`.
F18. Textured rectangle explicitly passes dither=false, independently of E1 bit9. Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:655-668`.
F19. Rectangle UV advances one texel per destination pixel/row (or minus one if flipped); 96x64 at initialUV0 and no flip samples U0..95,V0..63, not one fixed coordinate. Source: `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:632-641`.
F20. E6 lowbit0 forces output mask; lowbit1 checks destination mask; explicit E6000000H disables both. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:337-343`.
F21. Admitted RGB555 stores R5 OR(G5<<5) OR(B5<<10); no blending when disabled; without force-mask bit15 comes from fetched sample, not old destination. F15/F20 plus opaque opcode make the derived source words below actual stored words for covered, unskipped pixels. Source: `machine/ts/render/backend/software/gx_gpu_vram.ts:115-126`.
F22. Fill02684838H converts RGB bytes(56,72,104) by >>3 to (7,9,13); packing gives 7+(9<<5)+(13<<10)=3527H. Source: `machine/ts/render/backend/software/gx_gpu_vram.ts:15-18`.
F23. Fill X aligns down16; width rounds up16 from low10 bits; height uses low9. Packet [02684838H,00000280H,00400060H] therefore has exact X640,width96,height64. Source: `machine/ts/render/backend/gx_gpu_render_rules.ts:125-134`.
F24. Fill writes converted words directly (no draw-area/offset,mask,blend,dither path), but honors retained skipped-row parity; F23 initializes (640..735,0..63) entirely once parity is disabled. Source: `machine/ts/render/backend/software/gx_gpu_commands.ts:53-72`.
F25. Commands execute in increasing command index, so the preceding source fill completes before later texture reads in this software path. Source: `machine/ts/render/backend/software/gx_gpu_commands.ts:276-301`.
F26. Skip-active-field mask includes bit10, while required comparison word excludes it; thus bit10=1 prevents the skip condition regardless vertical/interlace bits. Source: `machine/ts/machine/devices/gx/gpu.ts:194-195`.
F27. False skip condition selects GX_GPU_SKIPPED_LINE_NONE, not either active parity. Source: `machine/ts/machine/devices/gx/gpu.ts:2002-2006`.
F28. No-skip sentinel is2; row parity is only0/1. Source: `machine/ts/machine/devices/gx/gpu_command_buffer.ts:15-15`.
F29. GP1 opcode02 is interrupt acknowledgement. Source: `machine/ts/spec/gx/gp1.ts:3-3`.
F30. GP1 ACK clears the GPU interrupt-request status bit. Source: `machine/ts/machine/devices/gx/gpu.ts:1355-1358`.
D01. OFF d=0: S=(54,56,130), RGB5=(6,7,16), word=6+(7<<5)+(16<<10)=40E6H. Rectangles OFF and ON also give40E6H throughout the initialized footprint.
D02. d=-4/-3 ->RGB5(6,6,15)->3CC6H; d=-2/-1 ->(6,6,16)->40C6H; d=0/+1 ->(6,7,16)->40E6H; d=+2/+3 ->(7,7,16)->40E7H.
D03. At an aligned destination origin (X AND3=Y AND3=0), the ON4x4 stored words are rows [3CC6,40E6,3CC6,40E6], [40E7,40C6,40E7,40C6], [3CC6,40E6,3CC6,40E6], [40E7,40C6,40E7,40C6]. The4x4 matrix yields a repeated2x2 output for this material.
C++ mirror anchors below confirm the same numbered facts (one path/range per entry).
M02. F03: `machine/cpp/render/backend/gx_gpu_render_rules.h:303-313`.
M03. F04: `machine/cpp/spec/gx/gp0.h:105-115`.
M04. F05: `machine/cpp/machine/devices/gx/gpu.cpp:815-821`.
M05. F06: `machine/cpp/render/backend/gx_gpu_render_rules.h:71-89`.
M06. F07: `machine/cpp/render/backend/software/gx_gpu_commands.cpp:172-184`.
M07. F08: `machine/cpp/render/backend/software/gx_gpu_commands.cpp:214-232`.
M08. F09: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:49-59`.
M09. F10: `machine/cpp/render/backend/gx_gpu_render_rules.h:325-339`.
M10. F11: `machine/cpp/render/backend/gx_gpu_render_rules.h:32-61`.
M11. F12: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:579-583`.
M12. F13: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:78-90`.
M13. F14: `machine/cpp/render/backend/software/gx_gpu_vram.h:37-48`.
M14. F15: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:106-120`.
M15. F16: `machine/cpp/render/backend/software/gx_gpu_vram.h:125-159`.
M16. F17: `machine/cpp/render/backend/gx_gpu_render_rules.h:296-301`.
M17. F18: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:699-710`.
M18. F19: `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:677-686`.
M19. F20: `machine/cpp/render/backend/gx_gpu_render_rules.h:341-347`.
M20. F21: `machine/cpp/render/backend/software/gx_gpu_vram.h:112-122`.
M21. F22: `machine/cpp/render/backend/software/gx_gpu_vram.h:27-31`.
M22. F23: `machine/cpp/render/backend/gx_gpu_render_rules.h:117-127`.
M23. F24: `machine/cpp/render/backend/software/gx_gpu_commands.cpp:11-38`.
M24. F25: `machine/cpp/render/backend/software/gx_gpu_commands.cpp:289-319`.
M25. F26: `machine/cpp/machine/devices/gx/gpu.cpp:26-27`.
M26. F27: `machine/cpp/machine/devices/gx/gpu.cpp:1476-1480`.
M27. F28: `machine/cpp/machine/devices/gx/gpu_command_buffer.h:23-23`.
M28. F29: `machine/cpp/spec/gx/gp1.h:9-9`.
M29. F30: `machine/cpp/machine/devices/gx/gpu.cpp:864-867`.

## Authored cartridge and observed output — 2026-10-19

- Literal program: `carts/gpu_dither_manual/cart.lua`, SHA256 `e9b76ebe526f888e77eb0ee2f4ea0d57acc8dc97d44e7e8ae7490c4a28c8b60f`; sole-ROM manifest at `carts/gpu_dither_manual/res/manifest/manifest.rommanifest`. It uses the accepted `gpu_manual` display/IRQ recipe and typed firmware source idioms, not a new library API.
- Packet origins: quads OFF/ON at `(16,24)`/`(144,24)` with opposite edges at X112/240,Y88; rectangle controls OFF/ON at `(16,112)`/`(144,112)`, width96,height64. Both source and destination regions have Y<192 and do not touch firmware terminal/atlas storage. Source: the literal program and the separately sourced reservation account in `gpu-startup.md`; these operands are not a general raster-edge guarantee.
- Current stream: 35 readonly command words, six explicit E1–E6 setup words, one final IRQ marker; 42 GP0 stores before polls/acknowledgements. The first quad's T1 selects the page while preserving initial dither-off; there is no redundant E1 write before that quad. Source: the literal program.
- Actual debug-ROM build passes. Separately rebuilt ordinary headless player reaches its 2000-ms virtual-clock TTL with the ordinary ROM. This is execution, not validation of the picture by exit status. Logs: `/tmp/bmsx-gpu-dither-{cart-build,player-build,ordinary}.log`.
- Existing integration route passes `polygon_dither_and_rectangle_controls`. It captures before probing, then checks five 4x4 GPUREAD blocks: both quad origins, both rectangle origins and source `(640,0)`. Each yields eight packed words; all40 comparisons and each final READY-clear check pass. Sources: `tests/carts/gpu_dither_manual/gpu_dither_manual_assert.lua`, `/tmp/bmsx-gpu-dither-guest.log`. It is a derived integration image, not byte-identical ordinary-ROM playback.
- Actual full256x192 PNG: `docs/book1/figures/gpu-dither-controls.png`, SHA256 `481d2b9874161be2d9ad0e7156a2a2efac01da1af375b5aeb42785d699bad40f`, byte-identical to `tests/carts/gpu_dither_manual/screenshots/frame_00001.png`. Viewed individually at original resolution, uncropped and without added labels or generated pixels.
- Passive complete-panel inspection finds each96x64 control uniformly RGBA `(49,57,132,255)`. The dithered quad has1536 pixels each of `(49,49,123,255)`, `(49,57,132,255)`, `(57,57,132,255)` and `(49,49,132,255)`. This is displayed output evidence separate from the raw RGB555 table. Inspection: `/tmp/bmsx-gpu-dither-output-pixels-current.json`.
- No native execution of the cartridge, accelerated-backend parity, arbitrary geometry coverage or physical-rate guarantee is established. No runtime, BIOS, compiler, publisher or harness implementation was changed.

- The program does not add a pre-stream GP1 ACK after CSR RESET: CSR already calls register reset and installs the reset status, clearing the GPU request. Post-marker GPU and controller acknowledgements remain. Sources: TS `machine/ts/machine/devices/gx/gpu.ts:755-774,1411-1415`; C++ `machine/cpp/machine/devices/gx/gpu.cpp:285-304,920-924`.
