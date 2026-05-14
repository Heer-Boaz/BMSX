#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include <array>

namespace bmsx {

struct VdpReadbackState {
	u32 readBudgetBytes = 0u;
	bool readOverflow = false;
};

class VdpReadbackUnit {
public:
	u32 resolvedSurfaceId = 0u;
	u32 faultCode = VDP_FAULT_NONE;
	u32 faultDetail = 0u;
	u32 word = 0u;
	u32 nextX = 0u;
	u32 nextY = 0u;
	bool advanceReadPosition = false;

	void resetSurfaceRegistry();
	void registerSurface(u32 surfaceId);
	void invalidateSurface(u32 surfaceId);
	void beginFrame();
	u32 status() const;
	bool resolveSurface(u32 requestedSurfaceId, u32 mode);
	bool readPixel(const VdpSurfaceUploadSlot& surface, u32 x, u32 y);
	VdpReadbackState captureState() const;
	void restoreState(const VdpReadbackState& state);

private:
	struct ReadSurface {
		u32 surfaceId = 0u;
		bool registered = false;
	};
	static constexpr u32 ReadbackBudgetBytes = 4096u;
	static constexpr u32 ReadbackMaxChunkPixels = 256u;

	struct ReadCache {
		u32 x0 = 0u;
		u32 y = 0u;
		u32 width = 0u;
		std::array<u8, ReadbackMaxChunkPixels * 4u> data{};
	};

	ReadCache& getReadCache(u32 surfaceId, const VdpSurfaceUploadSlot& surface, u32 x, u32 y);
	void prefetchReadCache(u32 surfaceId, const VdpSurfaceUploadSlot& surface, u32 x, u32 y);
	void copySurfacePixels(const VdpSurfaceUploadSlot& surface, u32 x, u32 y, u32 width, u32 height, std::array<u8, ReadbackMaxChunkPixels * 4u>& out);

	std::array<ReadSurface, VDP_RD_SURFACE_COUNT> m_readSurfaces{};
	std::array<ReadCache, VDP_RD_SURFACE_COUNT> m_readCaches{};
	u32 m_readBudgetBytes = ReadbackBudgetBytes;
	bool m_readOverflow = false;
};

} // namespace bmsx
