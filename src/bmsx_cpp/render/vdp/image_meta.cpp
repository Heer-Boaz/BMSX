#include "render/vdp/image_meta.h"

#include "machine/bus/io.h"
#include "machine/memory/memory.h"
#include "rompack/format.h"

namespace bmsx {

uint32_t resolveAtlasSlotFromMemory(const Memory& memory, int32_t atlasId) {
	if (atlasId == BIOS_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	const uint32_t atlas = static_cast<uint32_t>(atlasId);
	if (memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) == atlas) {
		return VDP_SLOT_PRIMARY;
	}
	if (memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) == atlas) {
		return VDP_SLOT_SECONDARY;
	}
	throw BMSX_RUNTIME_ERROR("[VDPImageMeta] Atlas " + std::to_string(atlasId) + " is not loaded in a VDP slot.");
}

ImageSlotSource resolveImageSlotSourceFromAssets(const RuntimeAssets& assets, const Memory& memory, const std::string& imgId) {
	const ImageAtlasRect rect = resolveImageAtlasRectFromAssets(assets, imgId);
	return ImageSlotSource{
		resolveAtlasSlotFromMemory(memory, rect.atlasId),
		rect.u,
		rect.v,
		rect.w,
		rect.h,
	};
}

} // namespace bmsx
