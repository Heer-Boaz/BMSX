#pragma once

#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/sbx.h"
#include <vector>

namespace bmsx {

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
	u32 skyboxControl = 0;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	VdpSkyboxSamples skyboxSamples{};
};

struct VdpBuildingFrame {
	std::vector<VdpBlitterCommand> queue;
	std::vector<VdpBbuBillboardEntry> billboards;
	bool open = false;
	int cost = 0;
};

struct VdpExecutionState {
	std::vector<VdpBlitterCommand> queue;
	bool pending = false;
};

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame);

} // namespace bmsx
