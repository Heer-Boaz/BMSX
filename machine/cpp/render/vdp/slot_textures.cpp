#include "render/vdp/slot_textures.h"

#include "common/primitives.h"
#include "common/types.h"
#include "machine/devices/vdp/vdp.h"
#include "render/backend/backend.h"
#include "render/backend/texture_params.h"
#include "render/gameview.h"
#include "render/texture_manager.h"
#include "render/vdp/surfaces.h"
#include <array>
#include <cstddef>
#include <string>

namespace bmsx {
namespace {

const std::array<u8, 4> EMPTY_TEXTURE_SEED{{0, 0, 0, 0}};

} // namespace

VdpSlotTextures::VdpSlotTextures(TextureManager& textureManager, GameView& view)
	: m_textureManager(textureManager)
	, m_view(view) {
}

void VdpSlotTextures::initialize(VDP& vdp) {
	m_syncedTextureWidths.fill(0U);
	m_syncedTextureHeights.fill(0U);
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
		const TextureHandle handle = m_textureManager.resizeTextureForKey(surface.textureKey, static_cast<i32>(width), static_cast<i32>(height), RGBA8_SRGB_TEXTURE_PARAMS);
		m_view.textures[surface.textureKey] = handle;
		noteSyncedTextureSize(upload.surfaceId, width, height);
	}
	if (!forceFullUpload && upload.dirtyRowStart >= upload.dirtyRowEnd) {
		return;
	}
	if (forceFullUpload) {
		uploadVdpSlotRows(surface.textureKey, upload, 0U, height);
	} else {
		for (u32 row = upload.dirtyRowStart; row < upload.dirtyRowEnd; ++row) {
			const auto& span = (*upload.dirtySpansByRow)[row];
			if (span.xStart < span.xEnd) {
				uploadVdpSlotSpan(surface.textureKey, upload, row, span.xStart, span.xEnd);
			}
		}
	}
}

auto VdpSlotTextures::readSurfaceTexturePixels(u32 surfaceId) const -> VdpSlotTexturePixels {
	const VdpSlotTextureReadback& readback = m_surfaceReadbacks[surfaceId];
	if (readback.pixels == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDPSlotTextures] surface texture has no synced pixels.");
	}
	return VdpSlotTexturePixels{
		.pixels=readback.pixels,
		.width=readback.width,
		.height=readback.height,
		.stride=readback.stride,
	};
}

auto VdpSlotTextures::readSurfaceTextureWidth(u32 surfaceId) const -> u32 {
	return m_syncedTextureWidths[surfaceId];
}

auto VdpSlotTextures::readSurfaceTextureHeight(u32 surfaceId) const -> u32 {
	return m_syncedTextureHeights[surfaceId];
}

auto VdpSlotTextures::readSurfaceTextureHandle(u32 surfaceId) const -> TextureHandle {
	return m_textureManager.getTextureByUri(resolveVdpSurfaceTextureKey(surfaceId), RGBA8_SRGB_TEXTURE_PARAMS);
}

auto VdpSlotTextures::isSyncedTextureSize(u32 surfaceId, u32 width, u32 height) const -> bool {
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
	readback.stride = upload.surfaceWidth * 4U;
}

void VdpSlotTextures::uploadVdpSlotRows(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 rowStart, u32 rowEnd) {
	const u32 rowBytes = upload.surfaceWidth * 4U;
	const size_t byteOffset = static_cast<size_t>(rowStart) * static_cast<size_t>(rowBytes);
	const u8* pixels = upload.cpuReadback->data() + byteOffset;
	noteSlotTexturePixels(upload);
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(textureKey, RGBA8_SRGB_TEXTURE_PARAMS),
		pixels,
		static_cast<i32>(upload.surfaceWidth),
		static_cast<i32>(rowEnd - rowStart),
		0,
		static_cast<i32>(rowStart),
		RGBA8_SRGB_TEXTURE_PARAMS
	);
}

void VdpSlotTextures::uploadVdpSlotSpan(const std::string& textureKey, const VdpSurfaceUpload& upload, u32 row, u32 xStart, u32 xEnd) {
	const u32 rowBytes = upload.surfaceWidth * 4U;
	const size_t byteOffset = (static_cast<size_t>(row) * static_cast<size_t>(rowBytes)) + (static_cast<size_t>(xStart) * 4U);
	const u8* pixels = upload.cpuReadback->data() + byteOffset;
	noteSlotTexturePixels(upload);
	m_view.backend()->updateTextureRegion(
		m_textureManager.getTextureByUri(textureKey, RGBA8_SRGB_TEXTURE_PARAMS),
		pixels,
		static_cast<i32>(xEnd - xStart),
		1,
		static_cast<i32>(xStart),
		static_cast<i32>(row),
		RGBA8_SRGB_TEXTURE_PARAMS
	);
}

void VdpSlotTextures::initializeVdpSlotTexture(const VdpSurfaceUpload& upload) {
	const VdpRenderSurfaceInfo surface = resolveVdpRenderSurfaceForUpload(upload);
	m_textureManager.createTextureFromPixelsSync(surface.textureKey, EMPTY_TEXTURE_SEED.data(), 1, 1, RGBA8_SRGB_TEXTURE_PARAMS);
	const TextureHandle handle = m_textureManager.resizeTextureForKey(
		surface.textureKey,
		static_cast<i32>(upload.surfaceWidth),
		static_cast<i32>(upload.surfaceHeight),
		RGBA8_SRGB_TEXTURE_PARAMS
	);
	m_view.textures[surface.textureKey] = handle;
	noteSyncedTextureSize(upload.surfaceId, upload.surfaceWidth, upload.surfaceHeight);
	uploadVdpSlotRows(surface.textureKey, upload, 0U, upload.surfaceHeight);
}

} // namespace bmsx
