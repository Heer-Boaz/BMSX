#include "render/vdp/slot_textures.h"

#include "common/primitives.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "render/vdp/surfaces.h"
#include <array>
#include <cstddef>

namespace bmsx {
namespace {

const std::array<u8, 4> EMPTY_TEXTURE_SEED{{0, 0, 0, 0}};

} // namespace

VdpSlotTextures::VdpSlotTextures(TextureManager& textureManager, GameView& view)
	: m_textureManager(textureManager)
	, m_view(view) {
}

void VdpSlotTextures::initialize(VDP& vdp) {
	m_syncedTextureWidths.fill(0u);
	m_syncedTextureHeights.fill(0u);
	for (VdpSlotTextureReadback& readback : m_surfaceReadbacks) {
		readback = VdpSlotTextureReadback{};
	}
	vdp.syncSurfaceUploads(*this);
}

void VdpSlotTextures::consumeVdpSurfaceUpload(const VdpSurfaceUpload& upload) {
	if (upload.requiresFullSync) {
		initializeVdpSlotTexture(upload);
		return;
	}
	const VdpRenderSurfaceInfo surface = resolveVdpRenderSurfaceForUpload(upload);
	const u32 width = upload.surfaceWidth;
	const u32 height = upload.surfaceHeight;
	const bool forceFullUpload = !isSyncedTextureSize(upload.surfaceId, width, height);
	if (forceFullUpload) {
		const TextureHandle handle = m_textureManager.resizeTextureForKey(surface.textureKey, static_cast<i32>(width), static_cast<i32>(height));
		m_view.textures[surface.textureKey] = handle;
		noteSyncedTextureSize(upload.surfaceId, width, height);
	}
	if (!forceFullUpload && upload.dirtyRowStart >= upload.dirtyRowEnd) {
		return;
	}
	if (forceFullUpload) {
		uploadVdpSlotRows(surface.textureKey, upload, 0u, height);
	} else {
		for (u32 row = upload.dirtyRowStart; row < upload.dirtyRowEnd; ++row) {
			const auto& span = (*upload.dirtySpansByRow)[row];
			if (span.xStart < span.xEnd) {
				uploadVdpSlotSpan(surface.textureKey, upload, row, span.xStart, span.xEnd);
			}
		}
	}
}

VdpSlotTexturePixels VdpSlotTextures::readSurfaceTexturePixels(u32 surfaceId) const {
	const VdpSlotTextureReadback& readback = m_surfaceReadbacks[surfaceId];
	if (readback.pixels == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDPSlotTextures] surface texture has no synced pixels.");
	}
	return VdpSlotTexturePixels{
		readback.pixels,
		readback.width,
		readback.height,
		readback.stride,
	};
}

bool VdpSlotTextures::isSyncedTextureSize(u32 surfaceId, u32 width, u32 height) const {
	return m_syncedTextureWidths[surfaceId] == width && m_syncedTextureHeights[surfaceId] == height;
}

void VdpSlotTextures::noteSyncedTextureSize(u32 surfaceId, u32 width, u32 height) {
	m_syncedTextureWidths[surfaceId] = width;
	m_syncedTextureHeights[surfaceId] = height;
}

void VdpSlotTextures::noteSlotTexturePixels(const VdpSurfaceUpload& upload) {
	VdpSlotTextureReadback& readback = m_surfaceReadbacks[upload.surfaceId];
	readback.pixels = upload.cpuReadback->data();
	readback.width = upload.surfaceWidth;
	readback.height = upload.surfaceHeight;
	readback.stride = upload.surfaceWidth * 4u;
}

void VdpSlotTextures::uploadVdpSlotRows(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 rowStart, u32 rowEnd) {
	const u32 rowBytes = upload.surfaceWidth * 4u;
	const size_t byteOffset = static_cast<size_t>(rowStart) * static_cast<size_t>(rowBytes);
	const u8* pixels = upload.cpuReadback->data() + byteOffset;
	noteSlotTexturePixels(upload);
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(textureKey),
		pixels,
		static_cast<i32>(upload.surfaceWidth),
		static_cast<i32>(rowEnd - rowStart),
		0,
		static_cast<i32>(rowStart),
		DEFAULT_TEXTURE_PARAMS
	);
}

void VdpSlotTextures::uploadVdpSlotSpan(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 row, u32 xStart, u32 xEnd) {
	const u32 rowBytes = upload.surfaceWidth * 4u;
	const size_t byteOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes) + static_cast<size_t>(xStart) * 4u;
	const u8* pixels = upload.cpuReadback->data() + byteOffset;
	noteSlotTexturePixels(upload);
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(textureKey),
		pixels,
		static_cast<i32>(xEnd - xStart),
		1,
		static_cast<i32>(xStart),
		static_cast<i32>(row),
		DEFAULT_TEXTURE_PARAMS
	);
}

void VdpSlotTextures::initializeVdpSlotTexture(const VdpSurfaceUpload& upload) {
	const VdpRenderSurfaceInfo surface = resolveVdpRenderSurfaceForUpload(upload);
	m_textureManager.createTextureFromPixelsSync(surface.textureKey, EMPTY_TEXTURE_SEED.data(), 1, 1);
	const TextureHandle handle = m_textureManager.resizeTextureForKey(
		surface.textureKey,
		static_cast<i32>(upload.surfaceWidth),
		static_cast<i32>(upload.surfaceHeight)
	);
	m_view.textures[surface.textureKey] = handle;
	noteSyncedTextureSize(upload.surfaceId, upload.surfaceWidth, upload.surfaceHeight);
	uploadVdpSlotRows(surface.textureKey, upload, 0u, upload.surfaceHeight);
}

} // namespace bmsx
