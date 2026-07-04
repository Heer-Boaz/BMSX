#include "machine/devices/vdp/frame.h"

namespace bmsx {

VdpSubmittedFrame allocateSubmittedFrameSlot(std::vector<u8>& vdpVram, std::vector<u32>& vdpVramPageRevisions) {
	return VdpSubmittedFrame{
		.rpu = createVdpRpuFrameOutput(vdpVram, vdpVramPageRevisions),
		.state = VdpSubmittedFrameState::Empty,
		.hasCommands = false,
		.cost = 0,
		.workRemaining = 0,
		.ditherType = 0,
		.frameBufferWidth = 0u,
		.frameBufferHeight = 0u,
		.xf = VdpXfUnit{},
		.lightRegisterWords = {},
		.morphWeightWords = {},
		.jointMatrixWords = {},
	};
}

void resetBuildingFrame(VdpBuildingFrame& frame) {
	resetVdpRpuFrameOutput(*frame.rpu);
	frame.cost = 0;
	frame.state = VdpDexFrameState::Idle;
}

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame) {
	frame.state = VdpSubmittedFrameState::Empty;
	frame.hasCommands = false;
	frame.cost = 0;
	frame.workRemaining = 0;
	frame.ditherType = 0;
	frame.frameBufferWidth = 0u;
	frame.frameBufferHeight = 0u;
	frame.xf.reset();
	frame.lightRegisterWords.fill(0u);
	frame.morphWeightWords.fill(0u);
	frame.jointMatrixWords.fill(0u);
	resetVdpRpuFrameOutput(*frame.rpu);
}

VdpBuildingFrameSaveState captureBuildingFrameState(const VdpBuildingFrame& frame) {
	VdpBuildingFrameSaveState state;
	state.state = frame.state;
	state.rpu = captureVdpRpuFrameState(*frame.rpu);
	state.cost = frame.cost;
	return state;
}

void restoreBuildingFrameState(VdpBuildingFrame& frame, const VdpBuildingFrameSaveState& state) {
	frame.state = state.state;
	restoreVdpRpuFrameState(*frame.rpu, state.rpu);
	frame.cost = state.cost;
}

VdpSubmittedFrameSaveState captureSubmittedFrameState(const VdpSubmittedFrame& frame) {
	VdpSubmittedFrameSaveState state;
	state.state = frame.state;
	state.hasCommands = frame.hasCommands;
	state.cost = frame.cost;
	state.workRemaining = frame.workRemaining;
	state.ditherType = frame.ditherType;
	state.frameBufferWidth = frame.frameBufferWidth;
	state.frameBufferHeight = frame.frameBufferHeight;
	state.xf = frame.xf.captureState();
	for (size_t index = 0u; index < state.lightRegisterWords.size(); ++index) {
		state.lightRegisterWords[index] = frame.lightRegisterWords[index];
	}
	for (size_t index = 0u; index < state.morphWeightWords.size(); ++index) {
		state.morphWeightWords[index] = frame.morphWeightWords[index];
	}
	for (size_t index = 0u; index < state.jointMatrixWords.size(); ++index) {
		state.jointMatrixWords[index] = frame.jointMatrixWords[index];
	}
	state.rpu = captureVdpRpuFrameState(*frame.rpu);
	return state;
}

void restoreSubmittedFrameState(VdpSubmittedFrame& frame, const VdpSubmittedFrameSaveState& state) {
	frame.state = state.state;
	frame.hasCommands = state.hasCommands;
	frame.cost = state.cost;
	frame.workRemaining = state.workRemaining;
	frame.ditherType = state.ditherType;
	frame.frameBufferWidth = state.frameBufferWidth;
	frame.frameBufferHeight = state.frameBufferHeight;
	frame.xf.restoreState(state.xf);
	for (size_t index = 0u; index < frame.lightRegisterWords.size(); ++index) {
		frame.lightRegisterWords[index] = state.lightRegisterWords[index];
	}
	for (size_t index = 0u; index < frame.morphWeightWords.size(); ++index) {
		frame.morphWeightWords[index] = state.morphWeightWords[index];
	}
	for (size_t index = 0u; index < frame.jointMatrixWords.size(); ++index) {
		frame.jointMatrixWords[index] = state.jointMatrixWords[index];
	}
	restoreVdpRpuFrameState(*frame.rpu, state.rpu);
}

} // namespace bmsx
