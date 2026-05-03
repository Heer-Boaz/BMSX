#include "render/vdp/slot_textures.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/surfaces.h"
#include "render/vdp/texture_transfer.h"
#include <array>
#include <unordered_map>

namespace bmsx {
namespace {

uint64_t packTextureSize(uint32_t width, uint32_t height) {
	return (static_cast<uint64_t>(width) << 32u) | static_cast<uint64_t>(height);
}

std::unordered_map<std::string, uint64_t> g_syncedTextureSizesByKey;
const std::array<u8, 4> EMPTY_TEXTURE_SEED{{0, 0, 0, 0}};

void noteSyncedTextureSize(const std::string& textureKey, uint32_t width, uint32_t height) {
	g_syncedTextureSizesByKey[textureKey] = packTextureSize(width, height);
}

void uploadVdpSlotRows(const std::string& textureKey, const VDP::VramSlot& slot, uint32_t rowStart, uint32_t rowEnd) {
	const uint32_t rowBytes = slot.surfaceWidth * 4u;
	const size_t byteOffset = static_cast<size_t>(rowStart) * static_cast<size_t>(rowBytes);
	updateVdpTextureRegion(
		textureKey,
		slot.cpuReadback.data() + byteOffset,
		static_cast<i32>(slot.surfaceWidth),
		static_cast<i32>(rowEnd - rowStart),
		0,
		static_cast<i32>(rowStart)
	);
}

void initializeVdpSlotTexture(VDP& vdp, const VDP::VdpHostOutput& output, const VDP::VramSlot& slot) {
	const VdpRenderSurfaceInfo surface = resolveVdpRenderSurface(output, slot.surfaceId);
	createVdpTextureFromSeed(surface.textureKey, EMPTY_TEXTURE_SEED.data(), slot.surfaceWidth, slot.surfaceHeight);
	noteSyncedTextureSize(surface.textureKey, slot.surfaceWidth, slot.surfaceHeight);
	uploadVdpSlotRows(surface.textureKey, slot, 0u, slot.surfaceHeight);
	vdp.clearSurfaceUploadDirty(slot.surfaceId);
}

} // namespace

void initializeVdpSlotTextures(VDP& vdp) {
	const VDP::VdpHostOutput output = vdp.hostOutput();
	for (const auto& slot : *output.surfaceUploadSlots) {
		if (isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		initializeVdpSlotTexture(vdp, output, slot);
	}
}

void syncVdpSlotTextures(VDP& vdp) {
	const VDP::VdpHostOutput output = vdp.hostOutput();
	for (const auto& slot : *output.surfaceUploadSlots) {
		if (isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		const VdpRenderSurfaceInfo surface = resolveVdpRenderSurface(output, slot.surfaceId);
		const uint32_t width = slot.surfaceWidth;
		const uint32_t height = slot.surfaceHeight;
		const uint64_t packedSize = packTextureSize(width, height);
		const auto sizeIt = g_syncedTextureSizesByKey.find(surface.textureKey);
		const uint64_t syncedSize = sizeIt == g_syncedTextureSizesByKey.end() ? 0u : sizeIt->second;
		const bool forceFullUpload = syncedSize != packedSize;
		if (forceFullUpload) {
			resizeVdpTextureForKey(surface.textureKey, width, height);
			noteSyncedTextureSize(surface.textureKey, width, height);
		}
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			continue;
		}
		const uint32_t rowStart = forceFullUpload ? 0u : slot.dirtyRowStart;
		const uint32_t rowEnd = forceFullUpload ? height : slot.dirtyRowEnd;
		uploadVdpSlotRows(surface.textureKey, slot, rowStart, rowEnd);
		vdp.clearSurfaceUploadDirty(slot.surfaceId);
	}
}

} // namespace bmsx
