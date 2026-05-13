#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/sbx.h"
#include "machine/devices/vdp/xf.h"
#include <vector>

namespace bmsx {

enum class VdpDexFrameState : u8 {
	Idle = 0,
	DirectOpen = 1,
	StreamOpen = 2,
};

struct VdpSubmittedFrame {
	std::vector<VdpBlitterCommand> queue;
	std::vector<VdpBbuBillboardEntry> billboards;
	bool occupied = false;
	bool hasCommands = false;
	bool hasFrameBufferCommands = false;
	bool ready = false;
	int cost = 0;
	int workRemaining = 0;
	i32 ditherType = 0;
	VdpXfUnit xf;
	u32 skyboxControl = 0;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	VdpSkyboxSamples skyboxSamples{};
};

struct VdpBuildingFrame {
	std::vector<VdpBlitterCommand> queue;
	std::vector<VdpBbuBillboardEntry> billboards;
	VdpDexFrameState state = VdpDexFrameState::Idle;
	int cost = 0;
};

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame);

} // namespace bmsx
