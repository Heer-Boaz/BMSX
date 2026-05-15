#include "machine/devices/vdp/blitter_source.h"

#include "machine/devices/device_status.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/vram.h"

namespace bmsx {

VdpBlitterSourcePort::VdpBlitterSourcePort(DeviceStatusLatch& fault, VdpVramUnit& vram)
	: m_fault(fault)
	, m_vram(vram) {}

bool VdpBlitterSourcePort::resolveSurfaceIdForSlot(u32 slot, u32& surfaceId, u32 faultCode) {
	if (slot == VDP_SLOT_SYSTEM) {
		surfaceId = VDP_RD_SURFACE_SYSTEM;
		return true;
	}
	if (slot == VDP_SLOT_PRIMARY) {
		surfaceId = VDP_RD_SURFACE_PRIMARY;
		return true;
	}
	if (slot == VDP_SLOT_SECONDARY) {
		surfaceId = VDP_RD_SURFACE_SECONDARY;
		return true;
	}
	m_fault.raise(faultCode, slot);
	return false;
}

VdpSurfaceUploadSlot* VdpBlitterSourcePort::resolveSlotSurface(u32 slot, u32 faultCode) {
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

bool VdpBlitterSourcePort::resolveWordsInto(u32 slot, u32 u, u32 v, u32 w, u32 h, VdpBlitterSource& target, u32 faultCode) {
	u32 surfaceId = 0u;
	if (!resolveSurfaceIdForSlot(slot, surfaceId, faultCode)) {
		return false;
	}
	target.surfaceId = surfaceId;
	target.srcX = u;
	target.srcY = v;
	target.width = w;
	target.height = h;
	return true;
}

bool VdpBlitterSourcePort::validateSurface(const VdpBlitterSource& source, u32 faultCode, u32 zeroSizeFaultCode) {
	if (source.width == 0u || source.height == 0u) {
		m_fault.raise(zeroSizeFaultCode, source.width | (source.height << 16u));
		return false;
	}
	const VdpSurfaceUploadSlot* surface = m_vram.findSurface(source.surfaceId);
	if (surface == nullptr) {
		m_fault.raise(faultCode, source.surfaceId);
		return false;
	}
	const uint64_t sourceRight = static_cast<uint64_t>(source.srcX) + static_cast<uint64_t>(source.width);
	const uint64_t sourceBottom = static_cast<uint64_t>(source.srcY) + static_cast<uint64_t>(source.height);
	if (sourceRight > surface->surfaceWidth || sourceBottom > surface->surfaceHeight) {
		m_fault.raise(faultCode, source.srcX | (source.srcY << 16u));
		return false;
	}
	return true;
}

} // namespace bmsx
