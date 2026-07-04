#include "machine/devices/vdp/unit_register_port.h"

#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/lpu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/xf.h"

namespace bmsx {

VdpUnitRegisterPort::VdpUnitRegisterPort(VdpXfUnit& xf, VdpLpuUnit& lpu, VdpMfuUnit& mfu, VdpJtuUnit& jtu)
	: m_xf(xf)
	, m_lpu(lpu)
	, m_mfu(mfu)
	, m_jtu(jtu) {}

void VdpUnitRegisterPort::writeWord(u32 packetKind, u32 registerIndex, u32 value) {
	switch (packetKind) {
		case VDP_XF_PACKET_KIND:
			m_xf.writeRegister(registerIndex, value);
			return;
		case VDP_LPU_PACKET_KIND:
			m_lpu.registerWords[static_cast<size_t>(registerIndex)] = value;
			return;
		case VDP_MFU_PACKET_KIND:
			m_mfu.weightWords[static_cast<size_t>(registerIndex)] = value;
			return;
		case VDP_JTU_PACKET_KIND:
			m_jtu.matrixWords[static_cast<size_t>(registerIndex)] = value;
			return;
	}
}

} // namespace bmsx
