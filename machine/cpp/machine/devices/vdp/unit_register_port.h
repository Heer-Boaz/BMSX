#pragma once

#include "common/primitives.h"

namespace bmsx {

class VdpJtuUnit;
class VdpLpuUnit;
class VdpMfuUnit;
class VdpXfUnit;

class VdpUnitRegisterPort final {
public:
	VdpUnitRegisterPort(VdpXfUnit& xf, VdpLpuUnit& lpu, VdpMfuUnit& mfu, VdpJtuUnit& jtu);

	void writeWord(u32 packetKind, u32 registerIndex, u32 value);

private:
	VdpXfUnit& m_xf;
	VdpLpuUnit& m_lpu;
	VdpMfuUnit& m_mfu;
	VdpJtuUnit& m_jtu;
};

} // namespace bmsx
