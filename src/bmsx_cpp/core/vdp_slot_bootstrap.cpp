#include "core/vdp_slot_bootstrap.h"

#include "core/primitives.h"
#include "machine/bus/io.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "rompack/package.h"
#include "rompack/format.h"

#include <cctype>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {
namespace {

uint32_t imageByteSize(uint32_t width, uint32_t height) {
	const uint64_t byteSize = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
	if (byteSize > std::numeric_limits<uint32_t>::max()) {
		throw BMSX_RUNTIME_ERROR("Image surface exceeds addressable VRAM span.");
	}
	return static_cast<uint32_t>(byteSize);
}

VdpVramSurface makeVramSurface(uint32_t surfaceId, uint32_t baseAddr, uint32_t capacity, uint32_t width, uint32_t height) {
	if (imageByteSize(width, height) > capacity) {
		throw BMSX_RUNTIME_ERROR("VDP surface exceeds mapped VRAM capacity.");
	}
	VdpVramSurface surface;
	surface.surfaceId = surfaceId;
	surface.baseAddr = baseAddr;
	surface.capacity = capacity;
	surface.width = width;
	surface.height = height;
	return surface;
}

std::vector<VdpVramSurface> buildVdpSlotSurfaces(const RuntimeRomPackage& systemRom, const VdpFrameBufferSize& frameBufferSize) {
	const std::string systemAtlasId = generateAtlasAssetId(BIOS_ATLAS_ID);
	const ImgAsset* systemAtlas = systemRom.getImg(systemAtlasId);
	if (!systemAtlas) {
		throw BMSX_RUNTIME_ERROR("System ROM atlas missing.");
	}
	const auto& systemAtlasMeta = systemAtlas->meta;
	if (systemAtlasMeta.width <= 0 || systemAtlasMeta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("System ROM atlas missing dimensions.");
	}
	return {
		makeVramSurface(VDP_RD_SURFACE_SYSTEM, VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE, static_cast<uint32_t>(systemAtlasMeta.width), static_cast<uint32_t>(systemAtlasMeta.height)),
		makeVramSurface(VDP_RD_SURFACE_PRIMARY, VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE, 1u, 1u),
		makeVramSurface(VDP_RD_SURFACE_SECONDARY, VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE, 1u, 1u),
		makeVramSurface(VDP_RD_SURFACE_FRAMEBUFFER, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, frameBufferSize.width, frameBufferSize.height),
	};
}

std::optional<i32> parseAtlasIdFromRomEntryId(const std::string& id) {
	const std::string prefix = "_atlas_";
	if (id.rfind(prefix, 0) != 0) {
		return std::nullopt;
	}
	i32 value = 0;
	for (size_t index = prefix.size(); index < id.size(); ++index) {
		const unsigned char ch = static_cast<unsigned char>(id[index]);
		if (!std::isdigit(ch)) {
			return std::nullopt;
		}
		value = value * 10 + static_cast<i32>(ch - '0');
	}
	return value;
}

void appendAtlasDimensions(VdpAtlasDimensionsById& out, const RuntimeRomPackage& rom) {
	for (const auto& pair : rom.img) {
		const ImgAsset& image = pair.second;
		if (image.rom.type != "atlas") {
			continue;
		}
		const std::optional<i32> parsedId = image.meta.atlasid ? image.meta.atlasid : parseAtlasIdFromRomEntryId(image.id);
		if (!parsedId || image.meta.width <= 0 || image.meta.height <= 0) {
			continue;
		}
		out[*parsedId] = VdpAtlasDimensions{
			static_cast<uint32_t>(image.meta.width),
			static_cast<uint32_t>(image.meta.height),
		};
	}
}

VdpAtlasDimensionsById collectAtlasDimensions(const RuntimeRomPackage& systemRom, const RuntimeRomPackage& activeRom) {
	VdpAtlasDimensionsById dimensions;
	appendAtlasDimensions(dimensions, systemRom);
	appendAtlasDimensions(dimensions, activeRom);
	return dimensions;
}

} // namespace

void configureVdpSlots(Runtime& runtime, const RuntimeRomPackage& systemRom, const RuntimeRomPackage& activeRom) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	memory.writeValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	memory.writeValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	machine.vdp().registerVramSurfaces(
		buildVdpSlotSurfaces(systemRom, machine.frameBufferSize()),
		collectAtlasDimensions(systemRom, activeRom)
	);
}

} // namespace bmsx
