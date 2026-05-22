#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/ingress.h"
#include "machine/devices/vdp/pmu.h"
#include "machine/devices/vdp/readback.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/vram.h"
#include "machine/devices/vdp/xf.h"
#include <array>
#include <vector>

namespace bmsx {

struct VdpState {
	VdpXfState xf{};
	std::array<u32, VDP_REGISTER_COUNT> vdpRegisterWords{};
	VdpBuildingFrameSaveState buildFrame;
	VdpSubmittedFrameSaveState activeFrame;
	VdpSubmittedFrameSaveState pendingFrame;
	VdpRpuSaveState rpu;
	i64 workCarry = 0;
	int availableWorkUnits = 0;
	VdpStreamIngressState streamIngress;
	VdpReadbackState readback;
	u32 pmuSelectedBank = 0;
	VdpPmuUnit::BankWords pmuBankWords{};
	std::array<u32, VDP_LPU_REGISTER_WORDS> lightRegisterWords{};
	std::array<u32, VDP_MFU_WEIGHT_COUNT> morphWeightWords{};
	std::array<u32, VDP_JTU_REGISTER_WORDS> jointMatrixWords{};
	i32 ditherType = 0;
	u32 vdpFaultCode = VDP_FAULT_NONE;
	u32 vdpFaultDetail = 0;
};

struct VdpSaveState : VdpState {
	VdpVramState vram;
	std::vector<u8> displayFrameBufferPixels;
};

} // namespace bmsx
