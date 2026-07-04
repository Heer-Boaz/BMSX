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

inline constexpr VdpEntropySeeds DEFAULT_VDP_ENTROPY_SEEDS{};

struct VdpSurfacePixelsState {
	u32 surfaceId = 0u;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	std::vector<u8> pixels;
};

struct VdpVramState {
	std::vector<u8> rpuVram;
	std::vector<VdpSurfacePixelsState> surfacePixels;
};

class VdpVramUnit {
public:
	VdpVramUnit(VdpFrameBufferSize frameBufferSize, VdpEntropySeeds entropySeeds = DEFAULT_VDP_ENTROPY_SEEDS);

	void initializeFrameBuffer();
	bool writeRpuVram(u32 addr, const u8* bytes, size_t srcOffset, size_t length);
	bool readRpuVram(u32 addr, u8* out, size_t length) const;
	void writeSurfaceBytes(VdpSurfaceBacking& surface, u32 offset, const u8* bytes, size_t srcOffset, size_t length);
	void readSurfaceBytes(const VdpSurfaceBacking& surface, u32 offset, u8* out, size_t length) const;
	void setSurfaceLogicalDimensions(VdpSurfaceBacking& surface, u32 width, u32 height);
	bool frameBufferContains(u32 addr, size_t length) const;
	VdpVramState captureState() const;
	void restoreState(const VdpVramState& state);
	u32 trackedUsedBytes() const;
	u32 trackedTotalBytes() const;

	std::vector<u8> rpuVram;
	std::vector<u32> rpuVramPageRevisions;
	VdpSurfaceBacking& frameBufferSurface() { return m_frameBufferSurface; }
	const VdpSurfaceBacking& frameBufferSurface() const { return m_frameBufferSurface; }

private:
	void configureFrameBufferSurface(u32 width, u32 height);
	std::vector<VdpSurfacePixelsState> captureSurfacePixels() const;
	void restoreSurfacePixels(const VdpSurfacePixelsState& state);
	void updateCpuReadback(VdpSurfaceBacking& surface, const u8* bytes, size_t srcOffset, size_t length, u32 x, u32 y);
	void seedSurfacePixels(VdpSurfaceBacking& surface);

	VdpSurfaceBacking m_frameBufferSurface;
	std::vector<u8> m_garbageScratch;
	VdpFrameBufferSize m_configuredFrameBufferSize;
	u32 m_machineSeed = 0u;
	u32 m_bootSeed = 0u;
};

} // namespace bmsx
