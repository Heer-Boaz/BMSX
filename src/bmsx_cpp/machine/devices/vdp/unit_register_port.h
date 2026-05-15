#pragma once

#include "common/primitives.h"

namespace bmsx {

class DeviceStatusLatch;
class VdpJtuUnit;
class VdpLpuUnit;
class VdpMfuUnit;
class VdpXfUnit;

class VdpUnitRegisterPort final {
public:
	VdpUnitRegisterPort(DeviceStatusLatch& fault, VdpXfUnit& xf, VdpLpuUnit& lpu, VdpMfuUnit& mfu, VdpJtuUnit& jtu);

	bool acceptRange(u32 packetKind, u32 firstRegister, u32 registerCount);
	bool writeWord(u32 packetKind, u32 registerIndex, u32 value);

private:
	DeviceStatusLatch& m_fault;
	VdpXfUnit& m_xf;
	VdpLpuUnit& m_lpu;
	VdpMfuUnit& m_mfu;
	VdpJtuUnit& m_jtu;
};

} // namespace bmsx
