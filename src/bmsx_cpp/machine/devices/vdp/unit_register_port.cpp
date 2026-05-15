#include "machine/devices/vdp/unit_register_port.h"

#include "machine/devices/device_status.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/lpu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/xf.h"

namespace bmsx {

VdpUnitRegisterPort::VdpUnitRegisterPort(DeviceStatusLatch& fault, VdpXfUnit& xf, VdpLpuUnit& lpu, VdpMfuUnit& mfu, VdpJtuUnit& jtu)
	: m_fault(fault)
	, m_xf(xf)
	, m_lpu(lpu)
	, m_mfu(mfu)
	, m_jtu(jtu) {}

bool VdpUnitRegisterPort::acceptRange(u32 packetKind, u32 firstRegister, u32 registerCount) {
	switch (packetKind) {
		case VDP_XF_PACKET_KIND:
			if (firstRegister >= VDP_XF_REGISTER_WORDS || registerCount > VDP_XF_REGISTER_WORDS - firstRegister) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
				return false;
			}
			return true;
		case VDP_LPU_PACKET_KIND:
			if (firstRegister >= VDP_LPU_REGISTER_WORDS || registerCount > VDP_LPU_REGISTER_WORDS - firstRegister) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
				return false;
			}
			return true;
		case VDP_MFU_PACKET_KIND:
			if (firstRegister >= VDP_MFU_WEIGHT_COUNT || registerCount > VDP_MFU_WEIGHT_COUNT - firstRegister) {
				m_fault.raise(VDP_FAULT_MDU_BAD_MORPH_RANGE, firstRegister);
				return false;
			}
			return true;
		case VDP_JTU_PACKET_KIND:
			if (firstRegister >= VDP_JTU_REGISTER_WORDS || registerCount > VDP_JTU_REGISTER_WORDS - firstRegister) {
				m_fault.raise(VDP_FAULT_MDU_BAD_JOINT_RANGE, firstRegister);
				return false;
			}
			return true;
	}
	m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
	return false;
}

bool VdpUnitRegisterPort::writeWord(u32 packetKind, u32 registerIndex, u32 value) {
	switch (packetKind) {
		case VDP_XF_PACKET_KIND:
			if (!m_xf.writeRegister(registerIndex, value)) {
				m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, value);
				return false;
			}
			return true;
		case VDP_LPU_PACKET_KIND:
			m_lpu.registerWords[static_cast<size_t>(registerIndex)] = value;
			return true;
		case VDP_MFU_PACKET_KIND:
			m_mfu.weightWords[static_cast<size_t>(registerIndex)] = value;
			return true;
		case VDP_JTU_PACKET_KIND:
			m_jtu.matrixWords[static_cast<size_t>(registerIndex)] = value;
			return true;
	}
	m_fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
	return false;
}

} // namespace bmsx
