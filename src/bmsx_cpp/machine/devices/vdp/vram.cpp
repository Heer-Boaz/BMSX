#include "machine/devices/vdp/vram.h"
#include "machine/memory/map.h"
#include <algorithm>
#include <cstring>
#include <string>
#include <utility>

namespace bmsx {
namespace {

uint64_t vramSurfaceByteSize(u32 width, u32 height) {
	return static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4u;
}

} // namespace

std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT> defaultVdpVramSurfaces(VdpFrameBufferSize frameBufferSize) {
	return {{
		{VDP_RD_SURFACE_SYSTEM, VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_PRIMARY, VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_SECONDARY, VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE, 1u, 1u},
		{VDP_RD_SURFACE_FRAMEBUFFER, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, frameBufferSize.width, frameBufferSize.height},
	}};
}

VdpVramUnit::VdpVramUnit(VdpEntropySeeds entropySeeds)
	: m_staging(VRAM_STAGING_SIZE)
	, m_garbageScratch(VRAM_GARBAGE_CHUNK_BYTES)
	, m_machineSeed(entropySeeds.machineSeed)
	, m_bootSeed(entropySeeds.bootSeed) {}

void VdpVramUnit::initializeSurfaces(const std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT>& surfaces) {
	m_slots.clear();
	m_slots.reserve(surfaces.size());
	VramGarbageStream stream{m_machineSeed, m_bootSeed, VRAM_GARBAGE_SPACE_SALT, VRAM_STAGING_BASE};
	fillVramGarbageScratch(m_staging.data(), m_staging.size(), stream);
	for (const auto& surface : surfaces) {
		registerSlot(surface);
	}
}

bool VdpVramUnit::writeStaging(u32 addr, const u8* data, size_t length) {
	if (addr < VRAM_STAGING_BASE || addr + length > VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		return false;
	}
	const u32 offset = addr - VRAM_STAGING_BASE;
	std::memcpy(m_staging.data() + offset, data, length);
	return true;
}

bool VdpVramUnit::readStaging(u32 addr, u8* out, size_t length) const {
	if (addr < VRAM_STAGING_BASE || addr + length > VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
		return false;
	}
	const u32 offset = addr - VRAM_STAGING_BASE;
	std::memcpy(out, m_staging.data() + offset, length);
	return true;
}

// start repeated-sequence-acceptable -- VRAM row streaming keeps read/write loops direct; callback helpers would add hot-path overhead.
void VdpVramUnit::writeSurfaceBytes(VdpSurfaceUploadSlot& slot, u32 offset, const u8* data, size_t length) {
	const u32 stride = slot.surfaceWidth * 4u;
	size_t remaining = length;
	size_t cursor = 0u;
	u32 row = offset / stride;
	u32 rowOffset = offset - row * stride;
	while (remaining > 0u) {
		const u32 rowAvailable = stride - rowOffset;
		const u32 rowBytes = static_cast<u32>(std::min<size_t>(remaining, rowAvailable));
		const u32 xStart = rowOffset / 4u;
		const u32 xEnd = xStart + rowBytes / 4u;
		markSlotDirtySpan(slot, row, xStart, xEnd);
		const size_t cpuOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(slot.cpuReadback.data() + cpuOffset, data + cursor, rowBytes);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1u;
		rowOffset = 0u;
	}
}

void VdpVramUnit::readSurfaceBytes(const VdpSurfaceUploadSlot& slot, u32 offset, u8* out, size_t length) const {
	const u32 stride = slot.surfaceWidth * 4u;
	size_t remaining = length;
	size_t cursor = 0u;
	u32 row = offset / stride;
	u32 rowOffset = offset - row * stride;
	while (remaining > 0u) {
		const u32 rowAvailable = stride - rowOffset;
		const u32 rowBytes = static_cast<u32>(std::min<size_t>(remaining, rowAvailable));
		const size_t srcOffset = static_cast<size_t>(row) * static_cast<size_t>(stride) + static_cast<size_t>(rowOffset);
		std::memcpy(out + cursor, slot.cpuReadback.data() + srcOffset, rowBytes);
		remaining -= rowBytes;
		cursor += rowBytes;
		row += 1u;
		rowOffset = 0u;
	}
}
// end repeated-sequence-acceptable

bool VdpVramUnit::setSlotLogicalDimensions(VdpSurfaceUploadSlot& slot, u32 width, u32 height) {
	const uint64_t size64 = vramSurfaceByteSize(width, height);
	if (width == 0u || height == 0u || size64 > slot.capacity) {
		return false;
	}
	const u32 size = static_cast<u32>(size64);
	if (slot.surfaceWidth == width && slot.surfaceHeight == height) {
		return true;
	}
	std::vector<u8> previous;
	if (slot.surfaceId != VDP_RD_SURFACE_SYSTEM) {
		previous.swap(slot.cpuReadback);
	}
	slot.surfaceWidth = width;
	slot.surfaceHeight = height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.assign(height, VdpDirtySpan{});
	if (slot.surfaceId == VDP_RD_SURFACE_SYSTEM) {
		slot.dirtyRowStart = 0u;
		slot.dirtyRowEnd = 0u;
		return true;
	}
	seedSlotPixels(slot);
	const size_t copyBytes = previous.size() < slot.cpuReadback.size() ? previous.size() : slot.cpuReadback.size();
	if (copyBytes > 0u) {
		std::memcpy(slot.cpuReadback.data(), previous.data(), copyBytes);
	}
	return true;
}

void VdpVramUnit::markSlotDirty(VdpSurfaceUploadSlot& slot, u32 startRow, u32 rowCount) {
	const u32 endRow = startRow + rowCount;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = startRow;
		slot.dirtyRowEnd = endRow;
	} else if (startRow < slot.dirtyRowStart) {
		slot.dirtyRowStart = startRow;
	}
	if (endRow > slot.dirtyRowEnd) {
		slot.dirtyRowEnd = endRow;
	}
	for (u32 row = startRow; row < endRow; ++row) {
		slot.dirtySpansByRow[row].xStart = 0u;
		slot.dirtySpansByRow[row].xEnd = slot.surfaceWidth;
	}
}

VdpSurfaceUploadSlot* VdpVramUnit::findMappedSlot(u32 addr, size_t length) {
	for (auto& slot : m_slots) {
		const u32 end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return &slot;
		}
	}
	return nullptr;
}

const VdpSurfaceUploadSlot* VdpVramUnit::findMappedSlot(u32 addr, size_t length) const {
	for (const auto& slot : m_slots) {
		const u32 end = slot.baseAddr + slot.capacity;
		if (addr >= slot.baseAddr && addr + length <= end) {
			return &slot;
		}
	}
	return nullptr;
}

VdpSurfaceUploadSlot* VdpVramUnit::findSurface(u32 surfaceId) {
	for (auto& slot : m_slots) {
		if (slot.surfaceId == surfaceId) {
			return &slot;
		}
	}
	return nullptr;
}

const VdpSurfaceUploadSlot* VdpVramUnit::findSurface(u32 surfaceId) const {
	for (const auto& slot : m_slots) {
		if (slot.surfaceId == surfaceId) {
			return &slot;
		}
	}
	return nullptr;
}

void VdpVramUnit::clearSurfaceUploadDirty(u32 surfaceId) {
	VdpSurfaceUploadSlot* slot = findSurface(surfaceId);
	if (slot == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDP VRAM] upload surface " + std::to_string(surfaceId) + " has no backing slot.");
	}
	for (u32 row = slot->dirtyRowStart; row < slot->dirtyRowEnd; ++row) {
		slot->dirtySpansByRow[row] = VdpDirtySpan{};
	}
	slot->dirtyRowStart = 0u;
	slot->dirtyRowEnd = 0u;
}

void VdpVramUnit::drainSurfaceUploads(VdpSurfaceUploadSink& sink) {
	for (const VdpSurfaceUploadSlot& slot : m_slots) {
		if (slot.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER && slot.dirtyRowStart < slot.dirtyRowEnd) {
			emitSurfaceUpload(sink, slot, false);
		}
	}
}

void VdpVramUnit::syncSurfaceUploads(VdpSurfaceUploadSink& sink) {
	for (const VdpSurfaceUploadSlot& slot : m_slots) {
		if (slot.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
			emitSurfaceUpload(sink, slot, true);
		}
	}
}

VdpVramState VdpVramUnit::captureState() const {
	VdpVramState state;
	state.staging = m_staging;
	state.surfacePixels = captureSurfacePixels();
	return state;
}

void VdpVramUnit::restoreState(const VdpVramState& state) {
	m_staging = state.staging;
	for (const VdpSurfacePixelsState& surface : state.surfacePixels) {
		restoreSurfacePixels(surface);
	}
}

u32 VdpVramUnit::trackedUsedBytes() const {
	u32 usedBytes = 0u;
	for (const auto& slot : m_slots) {
		usedBytes += slot.surfaceWidth * slot.surfaceHeight * 4u;
	}
	return usedBytes;
}

u32 VdpVramUnit::trackedTotalBytes() const {
	return VRAM_SYSTEM_SLOT_SIZE + VRAM_PRIMARY_SLOT_SIZE + VRAM_SECONDARY_SLOT_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
}

void VdpVramUnit::registerSlot(const VdpVramSurface& surface) {
	const uint64_t size64 = vramSurfaceByteSize(surface.width, surface.height);
	if (surface.width == 0u || surface.height == 0u || size64 > surface.capacity) {
		throw BMSX_RUNTIME_ERROR("[VDP VRAM] invalid surface " + std::to_string(surface.surfaceId) + " dimensions.");
	}
	const u32 size = static_cast<u32>(size64);
	VramGarbageStream stream{m_machineSeed, m_bootSeed, VRAM_GARBAGE_SPACE_SALT, surface.baseAddr};
	fillVramGarbageScratch(m_seedPixel.data(), m_seedPixel.size(), stream);
	VdpSurfaceUploadSlot slot;
	slot.baseAddr = surface.baseAddr;
	slot.capacity = surface.capacity;
	slot.surfaceId = surface.surfaceId;
	slot.surfaceWidth = surface.width;
	slot.surfaceHeight = surface.height;
	slot.cpuReadback.resize(static_cast<size_t>(size));
	slot.dirtySpansByRow.resize(surface.height);
	m_slots.push_back(std::move(slot));
	auto& slotRef = m_slots.back();
	if (surface.surfaceId != VDP_RD_SURFACE_SYSTEM) {
		seedSlotPixels(slotRef);
	}
}

std::vector<VdpSurfacePixelsState> VdpVramUnit::captureSurfacePixels() const {
	std::vector<VdpSurfacePixelsState> surfaces;
	surfaces.reserve(m_slots.size());
	for (const VdpSurfaceUploadSlot& slot : m_slots) {
		VdpSurfacePixelsState state;
		state.surfaceId = slot.surfaceId;
		state.surfaceWidth = slot.surfaceWidth;
		state.surfaceHeight = slot.surfaceHeight;
		state.pixels = slot.cpuReadback;
		surfaces.push_back(std::move(state));
	}
	return surfaces;
}

void VdpVramUnit::restoreSurfacePixels(const VdpSurfacePixelsState& state) {
	VdpSurfaceUploadSlot* slot = findSurface(state.surfaceId);
	if (slot == nullptr) {
		throw BMSX_RUNTIME_ERROR("[VDP VRAM] saved surface " + std::to_string(state.surfaceId) + " has no backing slot.");
	}
	if (!setSlotLogicalDimensions(*slot, state.surfaceWidth, state.surfaceHeight)) {
		throw BMSX_RUNTIME_ERROR("[VDP VRAM] saved surface " + std::to_string(state.surfaceId) + " has invalid dimensions.");
	}
	slot->cpuReadback = state.pixels;
	markSlotDirty(*slot, 0u, slot->surfaceHeight);
}

void VdpVramUnit::emitSurfaceUpload(VdpSurfaceUploadSink& sink, const VdpSurfaceUploadSlot& slot, bool requiresFullSync) {
	m_surfaceUploadOutput.surfaceId = slot.surfaceId;
	m_surfaceUploadOutput.surfaceWidth = slot.surfaceWidth;
	m_surfaceUploadOutput.surfaceHeight = slot.surfaceHeight;
	m_surfaceUploadOutput.cpuReadback = &slot.cpuReadback;
	m_surfaceUploadOutput.dirtyRowStart = slot.dirtyRowStart;
	m_surfaceUploadOutput.dirtyRowEnd = slot.dirtyRowEnd;
	m_surfaceUploadOutput.dirtySpansByRow = &slot.dirtySpansByRow;
	m_surfaceUploadOutput.requiresFullSync = requiresFullSync;
	sink.consumeVdpSurfaceUpload(m_surfaceUploadOutput);
	clearSurfaceUploadDirty(slot.surfaceId);
}

void VdpVramUnit::markSlotDirtySpan(VdpSurfaceUploadSlot& slot, u32 row, u32 xStart, u32 xEnd) {
	const u32 endRow = row + 1u;
	if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
		slot.dirtyRowStart = row;
		slot.dirtyRowEnd = endRow;
	} else {
		if (row < slot.dirtyRowStart) {
			slot.dirtyRowStart = row;
		}
		if (endRow > slot.dirtyRowEnd) {
			slot.dirtyRowEnd = endRow;
		}
	}
	auto& span = slot.dirtySpansByRow[row];
	if (span.xStart >= span.xEnd) {
		span.xStart = xStart;
		span.xEnd = xEnd;
		return;
	}
	if (xStart < span.xStart) {
		span.xStart = xStart;
	}
	if (xEnd > span.xEnd) {
		span.xEnd = xEnd;
	}
}

void VdpVramUnit::seedSlotPixels(VdpSurfaceUploadSlot& slot) {
	const size_t rowPixels = static_cast<size_t>(slot.surfaceWidth);
	const size_t maxPixels = m_garbageScratch.size() / 4u;
	slot.cpuReadback.resize(static_cast<size_t>(slot.surfaceWidth) * static_cast<size_t>(slot.surfaceHeight) * 4u);
	VramGarbageStream stream{m_machineSeed, m_bootSeed, VRAM_GARBAGE_SPACE_SALT, slot.baseAddr};
	const size_t rowBytes = rowPixels * 4u;
	const u32 height = slot.surfaceHeight;
	if (rowBytes <= m_garbageScratch.size()) {
		const size_t rowsPerChunk = std::max<size_t>(1u, m_garbageScratch.size() / rowBytes);
		for (u32 y = 0u; y < height; ) {
			const size_t rows = std::min<size_t>(rowsPerChunk, height - y);
			const size_t chunkBytes = rowBytes * rows;
			fillVramGarbageScratch(m_garbageScratch.data(), chunkBytes, stream);
			if (slot.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
				markSlotDirty(slot, y, static_cast<u32>(rows));
			}
			std::memcpy(slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes, m_garbageScratch.data(), chunkBytes);
			y += static_cast<u32>(rows);
		}
	} else {
		for (u32 y = 0u; y < height; ++y) {
			for (u32 x = 0u; x < slot.surfaceWidth; ) {
				const size_t segmentWidth = std::min<size_t>(maxPixels, slot.surfaceWidth - x);
				const size_t segmentBytes = segmentWidth * 4u;
				fillVramGarbageScratch(m_garbageScratch.data(), segmentBytes, stream);
				if (slot.surfaceId != VDP_RD_SURFACE_FRAMEBUFFER) {
					markSlotDirty(slot, y, 1u);
				}
				std::memcpy(
					slot.cpuReadback.data() + static_cast<size_t>(y) * rowBytes + static_cast<size_t>(x) * 4u,
					m_garbageScratch.data(),
					segmentBytes
				);
				x += static_cast<u32>(segmentWidth);
			}
		}
	}
}

} // namespace bmsx
