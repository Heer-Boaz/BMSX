#include "render/vdp/slot_textures.h"

#include "machine/devices/vdp/vdp.h"
#include "render/vdp/texture_transfer.h"
#include "rompack/format.h"
#include <array>
#include <unordered_map>

namespace bmsx {
namespace {

uint64_t packTextureSize(uint32_t width, uint32_t height) {
	return (static_cast<uint64_t>(width) << 32u) | static_cast<uint64_t>(height);
}

std::unordered_map<std::string, uint64_t> g_syncedTextureSizesByKey;
const std::array<u8, 4> EMPTY_TEXTURE_SEED{{0, 0, 0, 0}};

} // namespace

void syncVdpSlotTextures(VDP& vdp) {
	for (const auto& slot : vdp.renderTextureSlots()) {
		if (slot.textureKey == FRAMEBUFFER_RENDER_TEXTURE_KEY) {
			continue;
		}
		const uint32_t width = slot.textureWidth;
		const uint32_t height = slot.textureHeight;
		const uint64_t packedSize = packTextureSize(width, height);
		const auto sizeIt = g_syncedTextureSizesByKey.find(slot.textureKey);
		const uint64_t syncedSize = sizeIt == g_syncedTextureSizesByKey.end() ? 0u : sizeIt->second;
		bool forceFullUpload = false;
		TextureHandle handle = vdpTextureByUri(slot.textureKey);
		if (slot.textureKey == ENGINE_ATLAS_TEXTURE_KEY) {
			if (handle == nullptr || syncedSize != packedSize) {
				loadVdpEngineAtlasViewTexture();
				handle = vdpTextureByUri(slot.textureKey);
				if (handle == nullptr) {
					continue;
				}
				g_syncedTextureSizesByKey[slot.textureKey] = packedSize;
			}
		} else {
			if (handle == nullptr) {
				handle = ensureVdpTextureFromSeed(slot.textureKey, EMPTY_TEXTURE_SEED.data(), width, height);
				if (handle == nullptr) {
					continue;
				}
				g_syncedTextureSizesByKey[slot.textureKey] = packedSize;
				forceFullUpload = true;
			} else if (syncedSize != packedSize) {
				handle = resizeVdpTextureForKey(slot.textureKey, width, height);
				g_syncedTextureSizesByKey[slot.textureKey] = packedSize;
				forceFullUpload = true;
			}
		}
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			continue;
		}
		const uint32_t rowStart = forceFullUpload ? 0u : slot.dirtyRowStart;
		const uint32_t rowEnd = forceFullUpload ? height : slot.dirtyRowEnd;
		const uint32_t rowBytes = width * 4u;
		const size_t byteOffset = static_cast<size_t>(rowStart) * static_cast<size_t>(rowBytes);
		updateVdpTextureRegion(
			slot.textureKey,
			slot.cpuReadback.data() + byteOffset,
			static_cast<i32>(width),
			static_cast<i32>(rowEnd - rowStart),
			0,
			static_cast<i32>(rowStart)
		);
		vdp.clearRenderTextureSlotDirty(slot.textureKey);
	}
}

} // namespace bmsx
