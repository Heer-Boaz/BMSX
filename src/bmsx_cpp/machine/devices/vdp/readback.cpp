#include "machine/devices/vdp/readback.h"

#include <algorithm>
#include <cstring>

namespace bmsx {
void VdpReadbackUnit::resetSurfaceRegistry() {
	for (u32 surfaceId = 0u; surfaceId < VDP_RD_SURFACE_COUNT; ++surfaceId) {
		m_readSurfaces[surfaceId].surfaceId = surfaceId;
		m_readSurfaces[surfaceId].registered = false;
		invalidateSurface(surfaceId);
	}
}

void VdpReadbackUnit::registerSurface(u32 surfaceId) {
	m_readSurfaces[surfaceId].surfaceId = surfaceId;
	m_readSurfaces[surfaceId].registered = true;
	invalidateSurface(surfaceId);
}

void VdpReadbackUnit::invalidateSurface(u32 surfaceId) {
	m_readCaches[surfaceId].width = 0u;
}

void VdpReadbackUnit::beginFrame() {
	m_readBudgetBytes = ReadbackBudgetBytes;
	m_readOverflow = false;
}

u32 VdpReadbackUnit::status() const {
	u32 value = 0u;
	if (m_readBudgetBytes >= 4u) {
		value |= VDP_RD_STATUS_READY;
	}
	if (m_readOverflow) {
		value |= VDP_RD_STATUS_OVERFLOW;
	}
	return value;
}

bool VdpReadbackUnit::resolveSurface(u32 requestedSurfaceId, u32 mode) {
	faultCode = VDP_FAULT_NONE;
	faultDetail = 0u;
	advanceReadPosition = false;
	word = 0u;
	if (mode != VDP_RD_MODE_RGBA8888) {
		faultCode = VDP_FAULT_RD_UNSUPPORTED_MODE;
		faultDetail = mode;
		return false;
	}
	if (requestedSurfaceId >= VDP_RD_SURFACE_COUNT) {
		faultCode = VDP_FAULT_RD_SURFACE;
		faultDetail = requestedSurfaceId;
		return false;
	}
	const ReadSurface& readSurface = m_readSurfaces[requestedSurfaceId];
	if (!readSurface.registered) {
		faultCode = VDP_FAULT_RD_SURFACE;
		faultDetail = requestedSurfaceId;
		return false;
	}
	resolvedSurfaceId = readSurface.surfaceId;
	return true;
}

bool VdpReadbackUnit::readPixel(const VdpSurfaceUploadSlot& surface, u32 x, u32 y) {
	if (x >= surface.surfaceWidth || y >= surface.surfaceHeight) {
		faultCode = VDP_FAULT_RD_OOB;
		faultDetail = x | (y << 16u);
		word = 0u;
		return false;
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		word = 0u;
		advanceReadPosition = false;
		return true;
	}
	const ReadCache& cache = getReadCache(resolvedSurfaceId, surface, x, y);
	const u32 localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex];
	const u32 g = cache.data[byteIndex + 1u];
	const u32 b = cache.data[byteIndex + 2u];
	const u32 a = cache.data[byteIndex + 3u];
	m_readBudgetBytes -= 4u;
	nextX = x + 1u;
	nextY = y;
	if (nextX >= surface.surfaceWidth) {
		nextX = 0u;
		nextY = y + 1u;
	}
	advanceReadPosition = true;
	word = r | (g << 8u) | (b << 16u) | (a << 24u);
	return true;
}

VdpReadbackState VdpReadbackUnit::captureState() const {
	VdpReadbackState state;
	state.readBudgetBytes = m_readBudgetBytes;
	state.readOverflow = m_readOverflow;
	return state;
}

void VdpReadbackUnit::restoreState(const VdpReadbackState& state) {
	m_readBudgetBytes = state.readBudgetBytes;
	m_readOverflow = state.readOverflow;
}

VdpReadbackUnit::ReadCache& VdpReadbackUnit::getReadCache(u32 surfaceId, const VdpSurfaceUploadSlot& surface, u32 x, u32 y) {
	ReadCache& cache = m_readCaches[surfaceId];
	if (cache.width == 0u || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(surfaceId, surface, x, y);
	}
	return cache;
}

// start numeric-sanitization-acceptable -- readback chunk width is the minimum of hardware cap, remaining surface span, and per-frame read budget.
void VdpReadbackUnit::prefetchReadCache(u32 surfaceId, const VdpSurfaceUploadSlot& surface, u32 x, u32 y) {
	const u32 maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0u) {
		m_readOverflow = true;
		m_readCaches[surfaceId].width = 0u;
		return;
	}
	const u32 chunkW = std::min(ReadbackMaxChunkPixels, std::min(surface.surfaceWidth - x, maxPixelsByBudget));
	ReadCache& cache = m_readCaches[surfaceId];
	copySurfacePixels(surface, x, y, chunkW, 1u, cache.data);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}
// end numeric-sanitization-acceptable

void VdpReadbackUnit::copySurfacePixels(const VdpSurfaceUploadSlot& surface, u32 x, u32 y, u32 width, u32 height, std::array<u8, ReadbackMaxChunkPixels * 4u>& out) {
	const u32 stride = surface.surfaceWidth * 4u;
	const u32 rowBytes = width * 4u;
	for (u32 row = 0u; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes);
		std::memcpy(out.data() + dstOffset, surface.cpuReadback.data() + srcOffset, rowBytes);
	}
}

} // namespace bmsx
