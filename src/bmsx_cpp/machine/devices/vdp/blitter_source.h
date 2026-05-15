#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/blitter.h"

namespace bmsx {

class DeviceStatusLatch;
class VdpVramUnit;
struct VdpSurfaceUploadSlot;

class VdpBlitterSourcePort final {
public:
	VdpBlitterSourcePort(DeviceStatusLatch& fault, VdpVramUnit& vram);

	bool resolveSurfaceIdForSlot(u32 slot, u32& surfaceId, u32 faultCode);
	VdpSurfaceUploadSlot* resolveSlotSurface(u32 slot, u32 faultCode);
	bool resolveWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, VdpBlitterSource& target, u32 faultCode);
	bool validateSurface(const VdpBlitterSource& source, u32 faultCode, u32 zeroSizeFaultCode);

private:
	DeviceStatusLatch& m_fault;
	VdpVramUnit& m_vram;
};

} // namespace bmsx
