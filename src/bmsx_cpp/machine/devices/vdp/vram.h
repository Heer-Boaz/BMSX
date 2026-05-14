#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include "machine/devices/vdp/vram_garbage.h"
#include <array>
#include <vector>

namespace bmsx {

struct VdpFrameBufferSize {
	u32 width = 0u;
	u32 height = 0u;
};

struct VdpEntropySeeds {
	u32 machineSeed = 0x42564d58u;
	u32 bootSeed = 0x7652414du;
};

struct VdpVramSurface {
	u32 surfaceId = 0u;
	u32 baseAddr = 0u;
	u32 capacity = 0u;
	u32 width = 0u;
	u32 height = 0u;
};

struct VdpSurfacePixelsState {
	u32 surfaceId = 0u;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	std::vector<u8> pixels;
};

struct VdpVramState {
	std::vector<u8> staging;
	std::vector<VdpSurfacePixelsState> surfacePixels;
};

std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT> defaultVdpVramSurfaces(VdpFrameBufferSize frameBufferSize);

class VdpVramUnit {
public:
	explicit VdpVramUnit(VdpEntropySeeds entropySeeds = {});

	void initializeSurfaces(const std::array<VdpVramSurface, VDP_RD_SURFACE_COUNT>& surfaces);
	bool writeStaging(u32 addr, const u8* data, size_t length);
	bool readStaging(u32 addr, u8* out, size_t length) const;
	void writeSurfaceBytes(VdpSurfaceUploadSlot& slot, u32 offset, const u8* data, size_t length);
	void readSurfaceBytes(const VdpSurfaceUploadSlot& slot, u32 offset, u8* out, size_t length) const;
	bool setSlotLogicalDimensions(VdpSurfaceUploadSlot& slot, u32 width, u32 height);
	void markSlotDirty(VdpSurfaceUploadSlot& slot, u32 startRow, u32 rowCount);
	VdpSurfaceUploadSlot* findMappedSlot(u32 addr, size_t length);
	const VdpSurfaceUploadSlot* findMappedSlot(u32 addr, size_t length) const;
	VdpSurfaceUploadSlot* findSurface(u32 surfaceId);
	const VdpSurfaceUploadSlot* findSurface(u32 surfaceId) const;
	void clearSurfaceUploadDirty(u32 surfaceId);
	void drainSurfaceUploads(VdpSurfaceUploadSink& sink);
	void syncSurfaceUploads(VdpSurfaceUploadSink& sink);
	VdpVramState captureState() const;
	void restoreState(const VdpVramState& state);
	u32 trackedUsedBytes() const;
	u32 trackedTotalBytes() const;

	std::vector<VdpSurfaceUploadSlot>& slots() { return m_slots; }
	const std::vector<VdpSurfaceUploadSlot>& slots() const { return m_slots; }

private:
	void registerSlot(const VdpVramSurface& surface);
	std::vector<VdpSurfacePixelsState> captureSurfacePixels() const;
	void restoreSurfacePixels(const VdpSurfacePixelsState& state);
	void emitSurfaceUpload(VdpSurfaceUploadSink& sink, const VdpSurfaceUploadSlot& slot, bool requiresFullSync);
	void markSlotDirtySpan(VdpSurfaceUploadSlot& slot, u32 row, u32 xStart, u32 xEnd);
	void seedSlotPixels(VdpSurfaceUploadSlot& slot);

	std::vector<VdpSurfaceUploadSlot> m_slots;
	VdpSurfaceUpload m_surfaceUploadOutput;
	std::vector<u8> m_staging;
	std::vector<u8> m_garbageScratch;
	std::array<u8, 4u> m_seedPixel{{0u, 0u, 0u, 0u}};
	u32 m_machineSeed = 0u;
	u32 m_bootSeed = 0u;
};

} // namespace bmsx
