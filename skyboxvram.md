Here’s the short version so you can implement it yourself quickly.

Goal recap

Option 3: no auto cart asset-table load on boot; cart does it manually in init().
Remove skybox RAM copy and use IMGDEC/DMA path (so skybox uploads go through the same image-decoder→DMA path as atlas loads).
1) Manual cart asset table load
TS:

Remove auto cart asset loading in Runtime.prepareCartBoot():
currently does applyCartAssetLayers() + buildAssetMemory({mode:'cart'}) + vdp.uploadAtlasTextures() + refresh_audio_assets().
Instead just set sys_cart_bootready true (keep boot ready signal) and do not build assets here.
Expose a Lua builtin (e.g. load_cart_assets()) that:
calls applyCartAssetLayers()
buildAssetMemory({ mode: 'cart' })
vdp.uploadAtlasTextures()
refresh_audio_assets()
Update cart.lua init() to call load_cart_assets() before vdp_load_slot(...).
Same for entry.lua if you want parity.
C++:

In Runtime::prepareCartBootIfNeeded() remove the auto call to EngineCore::prepareLoadedRomAssets(). Keep only setCartBootReadyFlag(true).
Add a Lua builtin load_cart_assets() in C++ API:
Implement Api::load_cart_assets() → EngineCore::instance().prepareLoadedRomAssets()
Register it in Api::registerAllFunctions()
Add it to engine prelude builtins list in Runtime::runEngineBuiltinPrelude()
Update cart init() in Lua same as TS.
This gives manual control and stops “automatic cart asset table” rebuilds.

2) Remove skybox RAM copy — use IMGDEC + DMA
Key idea: don’t allocate _skybox_* image slots in RAM and don’t write skybox pixels into RAM. Instead, drive skybox face loads via IMGDEC (which already decodes PNG from ROM and DMA-writes into VRAM).

TS changes

In Runtime.computeAssetDataBytes() / collectAssetEntryIds():
remove skybox slot IDs (SKYBOX_SLOT_IDS) so RAM sizing doesn’t reserve bytes for them.
In VDP.registerImageAssets():
delete the block that registers SKYBOX_SLOT_IDS via registerImageSlot.
In VDP.setSkyboxImages():
don’t touch RAM. Instead:
store skyboxFaceIds
trigger IMGDEC jobs that decode each face into a dedicated VRAM target (needs new VRAM base/size for skybox faces)
when all 6 done → call SkyboxPipeline.setSkyboxSources(ids, loaders)
Replace the current loadSkyboxFaceIntoSlot() / applySkyboxSlots() code path:
Delete getSkyboxSlotEntries(), loadSkyboxFaceIntoSlot(), resolveSkyboxSlotSource(), applySkyboxSlots().
New flow should use ROM bytes → IMGDEC → VRAM.
You’ll need VRAM addresses for the 6 faces:
Add new VRAM region for skybox in memory_map.ts (right after staging is fine).
Add 6 bases: VRAM_SKYBOX_POSX_BASE etc. Size = faceSizefaceSize4.
Hook into IMGDEC:
IMGDEC in TS already supports destination VRAM (see ImgDecController.resolveSlotEntry).
You’ll extend that to accept the new skybox VRAM bases and return a fake entry or a new asset entry representing skybox face VRAM.
Or: create dummy “image slot entries” for skybox in VRAM (not RAM) with registerImageSlotAt using those VRAM bases so writeVram works.
After IMGDEC writes to VRAM, you need to build cubemap textures directly from VRAM:
SkyboxPipeline.setSkyboxSources() takes loaders that yield {width,height,data}.
For that, use readback from VRAM? (VRAM is write-only in Memory).
So instead: use texmanager.updateTextureRegion directly from IMGDEC output if you can intercept decoded pixels before DMA.
But you said “just use DMA path” → easiest is to write to VRAM and then use backend’s texture read. That’s not implemented in TS (VRAM is write-only).
So more practical: keep decoded pixels in JS for skybox only and call SkyboxPipeline.setSkyboxSources() with those.
(IMGDEC already has decoded pixels; you can fork there: if target is skybox, don’t write to RAM; instead pass pixels to skybox pipeline.)
This still uses IMGDEC path for decode and DMA scheduling, but avoids RAM copy.
Decide which of those is acceptable for you. If you strictly want “IMGDEC+DMA only”, you’ll need VRAM readback or direct cubemap upload from VRAM, which is more work.
C++ changes

Remove skybox slot allocations in VDP::registerImageAssets() (the _skybox_* RAM slots).
In VDP::setSkyboxImages():
don’t call loadSkyboxFaceIntoSlot.
instead, schedule IMGDEC jobs using IO_IMG_* like the BIOS does (or call a helper that enqueues IMGDEC on each face).
Extend ImgDecController::resolveSlotEntry() to support skybox face VRAM bases (similar to TS).
Add skybox VRAM bases/sizes in memory_map.h/.cpp.
Update EngineCore::collectAssetIds() and computeAssetDataBytes() to not include skybox slot IDs or bytes.
If you want “pure IMGDEC+DMA”:

in C++ you can read back from VRAM because backend has readTextureRegion.
But skybox pipeline likely uses cubemap textures. You can update cubemap faces directly from decoded pixels before DMA completes. That’s not strictly “DMA only”, but avoids RAM.
If you want it strict: add VRAM→CPU readback or direct GPU-side cubemap updates from VRAM textures. That’s bigger work.
3) Minimal cart-side Lua change
In cart.lua:

function init()
  load_cart_assets()
  vdp_load_slot(0, PRIMARY_ATLAS_ID)
  -- rest...
end
Summary

Stop auto cart asset table load in boot path.
Add load_cart_assets() builtin to TS+C++.
Cart init() triggers asset table load manually.
Remove skybox RAM slots; don’t write skybox pixels into RAM.
Use IMGDEC to decode skybox faces, then feed skybox pipeline without RAM copy.
If you must “DMA only”, you’ll need a VRAM→cubemap bridge (readback or direct GPU update).
If you want, tell me which exact DMA interpretation you want (strict VRAM-only vs “decode + use pixels”) and I can outline the smallest path.
