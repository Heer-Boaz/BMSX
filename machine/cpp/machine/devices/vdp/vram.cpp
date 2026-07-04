#include "machine/devices/vdp/vram.h"
#include "machine/devices/vdp/rpu.h"
#include "machine/memory/map.h"
#include <algorithm>
#include <string>
#include <utility>

namespace bmsx {
namespace {

inline u32 vramSurfaceByteSize(u32 width, u32 height) {
	return width * height * 4u;
}

} // namespace

VdpVramUnit::VdpVramUnit(VdpFrameBufferSize frameBufferSize, VdpEntropySeeds entropySeeds)
	: rpuVram(static_cast<size_t>(VRAM_STAGING_SIZE) + static_cast<size_t>(VRAM_TEXTURE_SIZE))
	, rpuVramPageRevisions(VDP_RPU_PARAM_MEM_PAGE_COUNT)
	, m_garbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_configuredFrameBufferSize(frameBufferSize)
	, m_machineSeed(entropySeeds.machineSeed)
	, m_bootSeed(entropySeeds.bootSeed) {
	configureFrameBufferSurface(m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height);
}

void VdpVramUnit::initializeFrameBuffer() {
	VramGarbageStream stream{m_machineSeed, m_bootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(rpuVram.data(), rpuVram.size(), stream);
	bumpVdpRpuVramPageRevisions(rpuVramPageRevisions.data(), 0u, rpuVram.size());
	configureFrameBufferSurface(m_configuredFrameBufferSize.width, m_configuredFrameBufferSize.height);
}

bool VdpVramUnit::writeRpuVram(u32 addr, const u8* bytes, size_t srcOffset, size_t length) {
	if (addr < VRAM_STAGING_BASE) {
		return false;
	}
	const size_t offset = static_cast<size_t>(addr - VRAM_STAGING_BASE);
	if (offset > rpuVram.size() || length > rpuVram.size() - offset) {
		return false;
	}
	for (size_t index = 0u; index < length; ++index) {
		rpuVram[offset + index] = bytes[srcOffset + index];
	}
	bumpVdpRpuVramPageRevisions(rpuVramPageRevisions.data(), static_cast<u32>(offset), length);
	return true;
}

bool VdpVramUnit::readRpuVram(u32 addr, u8* out, size_t length) const {
	if (addr < VRAM_STAGING_BASE) {
		return false;
	}
	const size_t offset = static_cast<size_t>(addr - VRAM_STAGING_BASE);
	if (offset > rpuVram.size() || length > rpuVram.size() - offset) {
		return false;
	}
	for (size_t index = 0u; index < length; ++index) {
		out[index] = rpuVram[offset + index];
	}
	return true;
}

// start repeated-sequence-acceptable -- VRAM row streaming keeps read/write loops direct; callback helpers would add hot-path overhead.
void VdpVramUnit::writeSurfaceBytes(VdpSurfaceBacking& surface, u32 offset, const u8* bytes, size_t srcOffset, size_t length) {
	const u32 stride = surface.surfaceWidth * 4u;
	size_t remaining = length;
	size_t cursor = srcOffset;
	u32 row = offset / stride;
	u32 rowOffset = offset - row * stride;
	while (remaining > 0u) {
		const u32 rowAvailable = stride - rowOffset;
		const u32 rowBytes = static_cast<u32>(std::min<size_t>(remaining, rowAvailable));
		updateCpuReadback(surface, bytes, cursor, rowBytes, rowOffset / 4u, row);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1u;
		rowOffset = 0u;
	}
}

void VdpVramUnit::readSurfaceBytes(const VdpSurfaceBacking& surface, u32 offset, u8* out, size_t length) const {
	const u32 stride = surface.surfaceWidth * 4u;
	size_t remaining = length;
	size_t cursor = 0u;
	u32 row = offset / stride;
	u32 rowOffset = offset - row * stride;
	while (remaining > 0u) {
		const u32 rowAvailable = stride - rowOffset;
		const u32 rowBytes = static_cast<u32>(std::min<size_t>(remaining, rowAvailable));
		const size_t srcOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		for (u32 byteIndex = 0u; byteIndex < rowBytes; ++byteIndex) {
			out[cursor + byteIndex] = surface.cpuReadback[srcOffset + byteIndex];
		}
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1u;
		rowOffset = 0u;
	}
}
// end repeated-sequence-acceptable

void VdpVramUnit::setSurfaceLogicalDimensions(VdpSurfaceBacking& surface, u32 width, u32 height) {
	const u32 size = vramSurfaceByteSize(width, height);
	if (surface.surfaceWidth == width && surface.surfaceHeight == height) {
		return;
	}
	std::vector<u8> previous;
	previous.swap(surface.cpuReadback);
	surface.surfaceWidth = width;
	surface.surfaceHeight = height;
	surface.cpuReadback.resize(static_cast<size_t>(size));
	seedSurfacePixels(surface);
	const size_t copyBytes = previous.size() < surface.cpuReadback.size() ? previous.size() : surface.cpuReadback.size();
	for (size_t index = 0u; index < copyBytes; ++index) {
		surface.cpuReadback[index] = previous[index];
	}
}

bool VdpVramUnit::frameBufferContains(u32 addr, size_t length) const {
	const VdpSurfaceBacking& surface = m_frameBufferSurface;
	return addr >= surface.baseAddr && addr + length <= surface.baseAddr + surface.capacity;
}

VdpVramState VdpVramUnit::captureState() const {
	VdpVramState state;
	state.rpuVram = rpuVram;
	state.surfacePixels = captureSurfacePixels();
	return state;
}

void VdpVramUnit::restoreState(const VdpVramState& state) {
	for (size_t index = 0u; index < state.rpuVram.size(); ++index) {
		rpuVram[index] = state.rpuVram[index];
	}
	bumpVdpRpuVramPageRevisions(rpuVramPageRevisions.data(), 0u, state.rpuVram.size());
	for (const VdpSurfacePixelsState& surface : state.surfacePixels) {
		restoreSurfacePixels(surface);
	}
}

u32 VdpVramUnit::trackedUsedBytes() const {
	return static_cast<u32>(rpuVram.size()) + static_cast<u32>(vramSurfaceByteSize(m_frameBufferSurface.surfaceWidth, m_frameBufferSurface.surfaceHeight));
}

u32 VdpVramUnit::trackedTotalBytes() const {
	return VRAM_STAGING_SIZE + VRAM_TEXTURE_SIZE + VRAM_FRAMEBUFFER_SIZE;
}

void VdpVramUnit::configureFrameBufferSurface(u32 width, u32 height) {
	const u32 size = vramSurfaceByteSize(width, height);
	m_frameBufferSurface.baseAddr = VRAM_FRAMEBUFFER_BASE;
	m_frameBufferSurface.capacity = VRAM_FRAMEBUFFER_SIZE;
	m_frameBufferSurface.surfaceId = VDP_RD_SURFACE_FRAMEBUFFER;
	m_frameBufferSurface.surfaceWidth = width;
	m_frameBufferSurface.surfaceHeight = height;
	m_frameBufferSurface.cpuReadback.resize(static_cast<size_t>(size));
	seedSurfacePixels(m_frameBufferSurface);
}

std::vector<VdpSurfacePixelsState> VdpVramUnit::captureSurfacePixels() const {
	std::vector<VdpSurfacePixelsState> surfaces;
	surfaces.reserve(1u);
	VdpSurfacePixelsState state;
	state.surfaceId = m_frameBufferSurface.surfaceId;
	state.surfaceWidth = m_frameBufferSurface.surfaceWidth;
	state.surfaceHeight = m_frameBufferSurface.surfaceHeight;
	state.pixels = m_frameBufferSurface.cpuReadback;
	surfaces.push_back(std::move(state));
	return surfaces;
}

void VdpVramUnit::restoreSurfacePixels(const VdpSurfacePixelsState& state) {
	m_frameBufferSurface.cpuReadback = state.pixels;
}

void VdpVramUnit::updateCpuReadback(VdpSurfaceBacking& surface, const u8* bytes, size_t srcOffset, size_t length, u32 x, u32 y) {
	const u32 stride = surface.surfaceWidth * 4u;
	const size_t offset = static_cast<size_t>(y) * static_cast<size_t>(stride) + static_cast<size_t>(x) * 4u;
	for (size_t index = 0u; index < length; ++index) {
		surface.cpuReadback[offset + index] = bytes[srcOffset + index];
	}
}

void VdpVramUnit::seedSurfacePixels(VdpSurfaceBacking& surface) {
	const size_t rowPixels = static_cast<size_t>(surface.surfaceWidth);
	const size_t maxPixels = m_garbageScratch.size() / 4u;
	surface.cpuReadback.resize(vramSurfaceByteSize(surface.surfaceWidth, surface.surfaceHeight));
	VramGarbageStream stream{m_machineSeed, m_bootSeed, VRAM_GARBAGE_SPACE_SALT, surface.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const u32 height = surface.surfaceHeight;
	if (rowBytes <= m_garbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_garbageScratch.size() / rowBytes);
		for (u32 y = 0u; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_garbageScratch.data(), chunkBytes, stream);
			for (size_t row = 0u; row < rows; ++row) {
				const size_t rowOffset = row * rowBytes;
				updateCpuReadback(surface, m_garbageScratch.data(), rowOffset, rowBytes, 0u, y + static_cast<u32>(row));
			}
			y += static_cast<u32>(rows);
		}
	} else {
		for (u32 y = 0u; y < height; ++y) {
			for (u32 x = 0u; x < surface.surfaceWidth; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, surface.surfaceWidth - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_garbageScratch.data(), segmentBytes, stream);
				updateCpuReadback(surface, m_garbageScratch.data(), 0u, segmentBytes, x, y);
				x += static_cast<u32>(segmentWidth);
			}
		}
	}
}

} // namespace bmsx
