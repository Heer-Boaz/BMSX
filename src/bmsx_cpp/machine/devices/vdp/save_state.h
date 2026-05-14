#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/frame.h"
#include "machine/devices/vdp/ingress.h"
#include "machine/devices/vdp/pmu.h"
#include "machine/devices/vdp/readback.h"
#include "machine/devices/vdp/registers.h"
#include "machine/devices/vdp/sbx.h"
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
	i64 workCarry = 0;
	int availableWorkUnits = 0;
	VdpStreamIngressState streamIngress;
	VdpReadbackState readback;
	u32 blitterSequence = 0;
	u32 skyboxControl = 0;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	u32 pmuSelectedBank = 0;
	VdpPmuUnit::BankWords pmuBankWords{};
	i32 ditherType = 0;
	u32 vdpFaultCode = VDP_FAULT_NONE;
	u32 vdpFaultDetail = 0;
};

struct VdpSurfacePixelsState {
	uint32_t surfaceId = 0;
	uint32_t surfaceWidth = 0;
	uint32_t surfaceHeight = 0;
	std::vector<u8> pixels;
};

struct VdpSaveState : VdpState {
	std::vector<u8> vramStaging;
	std::vector<VdpSurfacePixelsState> surfacePixels;
	std::vector<u8> displayFrameBufferPixels;
};

} // namespace bmsx
