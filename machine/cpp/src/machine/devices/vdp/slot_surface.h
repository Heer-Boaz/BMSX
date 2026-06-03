#pragma once

#include "common/primitives.h"

namespace bmsx {

class DeviceStatusLatch;
class VdpVramUnit;
struct VdpSurfaceUploadSlot;

class VdpSlotSurfacePort final {
public:
	VdpSlotSurfacePort(DeviceStatusLatch& fault, VdpVramUnit& vram);

	bool resolveSurfaceIdForSlot(u32 slot, u32& out, u32 faultCode);
	VdpSurfaceUploadSlot* resolveSlotSurface(u32 slot, u32 faultCode);

private:
	DeviceStatusLatch& m_fault;
	VdpVramUnit& m_vram;
};

} // namespace bmsx
