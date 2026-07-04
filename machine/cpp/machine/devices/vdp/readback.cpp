#include "machine/devices/vdp/readback.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
#include <algorithm>

namespace bmsx {
VdpReadbackUnit::VdpReadbackUnit(Memory& memory, DeviceStatusLatch& fault)
	: m_memory(memory)
	, m_fault(fault) {
}

void VdpReadbackUnit::invalidateFrameBuffer() {
	m_frameBufferCache.width = 0u;
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

u32 VdpReadbackUnit::read(const VdpSurfaceBacking& surface, u32 requestedSurfaceId, u32 mode, u32 x, u32 y) {
	if (mode != VDP_RD_MODE_RGBA8888) {
		m_fault.raise(VDP_FAULT_RD_UNSUPPORTED_MODE, mode);
		return 0u;
	}
	if (requestedSurfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
		m_fault.raise(VDP_FAULT_RD_SURFACE, requestedSurfaceId);
		return 0u;
	}
	if (x >= surface.surfaceWidth || y >= surface.surfaceHeight) {
		m_fault.raise(VDP_FAULT_RD_OOB, x | (y << 16u));
		return 0u;
	}
	if (m_readBudgetBytes < 4u) {
		m_readOverflow = true;
		return 0u;
	}
	const ReadCache& cache = getReadCache(surface, x, y);
	const u32 localX = x - cache.x0;
	const size_t byteIndex = static_cast<size_t>(localX) * 4u;
	const u32 r = cache.data[byteIndex];
	const u32 g = cache.data[byteIndex + 1u];
	const u32 b = cache.data[byteIndex + 2u];
	const u32 a = cache.data[byteIndex + 3u];
	m_readBudgetBytes -= 4u;
	u32 nextX = x + 1u;
	u32 nextY = y;
	if (nextX >= surface.surfaceWidth) {
		nextX = 0u;
		nextY = y + 1u;
	}
	m_memory.writeValue(IO_VDP_RD_X, valueNumber(static_cast<double>(nextX)));
	m_memory.writeValue(IO_VDP_RD_Y, valueNumber(static_cast<double>(nextY)));
	return r | (g << 8u) | (b << 16u) | (a << 24u);
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

VdpReadbackUnit::ReadCache& VdpReadbackUnit::getReadCache(const VdpSurfaceBacking& surface, u32 x, u32 y) {
	ReadCache& cache = m_frameBufferCache;
	if (cache.width == 0u || cache.y != y || x < cache.x0 || x >= cache.x0 + cache.width) {
		prefetchReadCache(cache, surface, x, y);
	}
	return cache;
}

// start numeric-sanitization-acceptable -- readback chunk width is the minimum of hardware cap, remaining surface span, and per-frame read budget.
void VdpReadbackUnit::prefetchReadCache(ReadCache& cache, const VdpSurfaceBacking& surface, u32 x, u32 y) {
	const u32 maxPixelsByBudget = m_readBudgetBytes / 4u;
	if (maxPixelsByBudget == 0u) {
		m_readOverflow = true;
		cache.width = 0u;
		return;
	}
	const u32 chunkW = std::min(ReadbackMaxChunkPixels, std::min(surface.surfaceWidth - x, maxPixelsByBudget));
	copySurfacePixels(cache, surface, x, y, chunkW, 1u);
	cache.x0 = x;
	cache.y = y;
	cache.width = chunkW;
}
// end numeric-sanitization-acceptable

void VdpReadbackUnit::copySurfacePixels(ReadCache& cache, const VdpSurfaceBacking& surface, u32 x, u32 y, u32 width, u32 height) {
	const u32 stride = surface.surfaceWidth * 4u;
	const u32 rowBytes = width * 4u;
	std::array<u8, ReadbackMaxChunkPixels * 4u>& out = cache.data;
	for (u32 row = 0u; row < height; ++row) {
		const size_t srcOffset = static_cast<size_t>(y + row) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
		const size_t dstOffset = static_cast<size_t>(row) * static_cast<size_t>(rowBytes);
		for (size_t byteIndex = 0u; byteIndex < rowBytes; ++byteIndex) {
			out[dstOffset + byteIndex] = surface.cpuReadback[srcOffset + byteIndex];
		}
	}
}

} // namespace bmsx
