#include "machine/devices/vdp/slot_surface.h"

#include "machine/devices/device_status.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vram.h"

namespace bmsx {

VdpSlotSurfacePort::VdpSlotSurfacePort(DeviceStatusLatch& fault, VdpVramUnit& vram)
	: m_fault(fault)
	, m_vram(vram) {}

bool VdpSlotSurfacePort::resolveSurfaceIdForSlot(u32 slot, u32& out, u32 faultCode) {
	if (slot == VDP_SLOT_SYSTEM) {
		out = VDP_RD_SURFACE_SYSTEM;
		return true;
	}
	if (slot == VDP_SLOT_PRIMARY) {
		out = VDP_RD_SURFACE_PRIMARY;
		return true;
	}
	if (slot == VDP_SLOT_SECONDARY) {
		out = VDP_RD_SURFACE_SECONDARY;
		return true;
	}
	m_fault.raise(faultCode, slot);
	return false;
}

VdpSurfaceUploadSlot* VdpSlotSurfacePort::resolveSlotSurface(u32 slot, u32 faultCode) {
	u32 surfaceId = 0u;
	if (!resolveSurfaceIdForSlot(slot, surfaceId, faultCode)) {
		return nullptr;
	}
	VdpSurfaceUploadSlot* surface = m_vram.findSurface(surfaceId);
	if (surface == nullptr) {
		m_fault.raise(faultCode, surfaceId);
		return nullptr;
	}
	return surface;
}

} // namespace bmsx
