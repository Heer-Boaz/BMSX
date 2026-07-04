#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include <array>

namespace bmsx {

class DeviceStatusLatch;
class Memory;

struct VdpReadbackState {
	u32 readBudgetBytes = 0u;
	bool readOverflow = false;
};

class VdpReadbackUnit {
public:
	VdpReadbackUnit(Memory& memory, DeviceStatusLatch& fault);

	void invalidateFrameBuffer();
	void beginFrame();
	u32 status() const;
	u32 read(const VdpSurfaceBacking& surface, u32 requestedSurfaceId, u32 mode, u32 x, u32 y);
	VdpReadbackState captureState() const;
	void restoreState(const VdpReadbackState& state);

private:
	static constexpr u32 ReadbackBudgetBytes = 4096u;
	static constexpr u32 ReadbackMaxChunkPixels = 256u;

	struct ReadCache {
		u32 x0 = 0u;
		u32 y = 0u;
		u32 width = 0u;
		std::array<u8, ReadbackMaxChunkPixels * 4u> data{};
	};

	ReadCache& getReadCache(const VdpSurfaceBacking& surface, u32 x, u32 y);
	void prefetchReadCache(ReadCache& cache, const VdpSurfaceBacking& surface, u32 x, u32 y);
	void copySurfacePixels(ReadCache& cache, const VdpSurfaceBacking& surface, u32 x, u32 y, u32 width, u32 height);

	Memory& m_memory;
	DeviceStatusLatch& m_fault;
	ReadCache m_frameBufferCache;
	u32 m_readBudgetBytes = ReadbackBudgetBytes;
	bool m_readOverflow = false;
};

} // namespace bmsx
