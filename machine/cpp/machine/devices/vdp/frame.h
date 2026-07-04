#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/lpu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/xf.h"
#include <memory>
#include <vector>

namespace bmsx {

constexpr u8 VDP_DEX_FRAME_IDLE = 0u;
constexpr u8 VDP_DEX_FRAME_DIRECT_OPEN = 1u;
constexpr u8 VDP_DEX_FRAME_STREAM_OPEN = 2u;

enum class VdpDexFrameState : u8 {
	Idle = VDP_DEX_FRAME_IDLE,
	DirectOpen = VDP_DEX_FRAME_DIRECT_OPEN,
	StreamOpen = VDP_DEX_FRAME_STREAM_OPEN,
};

constexpr u8 VDP_SUBMITTED_FRAME_EMPTY = 0u;
constexpr u8 VDP_SUBMITTED_FRAME_QUEUED = 1u;
constexpr u8 VDP_SUBMITTED_FRAME_EXECUTING = 2u;
constexpr u8 VDP_SUBMITTED_FRAME_READY = 3u;

enum class VdpSubmittedFrameState : u8 {
	Empty = VDP_SUBMITTED_FRAME_EMPTY,
	Queued = VDP_SUBMITTED_FRAME_QUEUED,
	Executing = VDP_SUBMITTED_FRAME_EXECUTING,
	Ready = VDP_SUBMITTED_FRAME_READY,
};

struct VdpSubmittedFrame {
	std::unique_ptr<VdpRpuFrameOutput> rpu;
	VdpSubmittedFrameState state = VdpSubmittedFrameState::Empty;
	bool hasCommands = false;
	int cost = 0;
	int workRemaining = 0;
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
	VdpXfUnit xf;
	std::array<u32, VDP_LPU_REGISTER_WORDS> lightRegisterWords{};
	std::array<u32, VDP_MFU_WEIGHT_COUNT> morphWeightWords{};
	std::array<u32, VDP_JTU_REGISTER_WORDS> jointMatrixWords{};
};

struct VdpBuildingFrame {
	std::unique_ptr<VdpRpuFrameOutput> rpu;
	VdpDexFrameState state = VdpDexFrameState::Idle;
	int cost = 0;
};

struct VdpBuildingFrameSaveState {
	VdpDexFrameState state = VdpDexFrameState::Idle;
	VdpRpuFrameSaveState rpu;
	int cost = 0;
};

struct VdpSubmittedFrameSaveState {
	VdpSubmittedFrameState state = VdpSubmittedFrameState::Empty;
	bool hasCommands = false;
	int cost = 0;
	int workRemaining = 0;
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
	VdpXfState xf;
	std::array<u32, VDP_LPU_REGISTER_WORDS> lightRegisterWords{};
	std::array<u32, VDP_MFU_WEIGHT_COUNT> morphWeightWords{};
	std::array<u32, VDP_JTU_REGISTER_WORDS> jointMatrixWords{};
	VdpRpuFrameSaveState rpu;
};

VdpSubmittedFrame allocateSubmittedFrameSlot(std::vector<u8>& vdpVram, std::vector<u32>& vdpVramPageRevisions);
void resetBuildingFrame(VdpBuildingFrame& frame);
void resetSubmittedFrameSlot(VdpSubmittedFrame& frame);
VdpBuildingFrameSaveState captureBuildingFrameState(const VdpBuildingFrame& frame);
void restoreBuildingFrameState(VdpBuildingFrame& frame, const VdpBuildingFrameSaveState& state);
VdpSubmittedFrameSaveState captureSubmittedFrameState(const VdpSubmittedFrame& frame);
void restoreSubmittedFrameState(VdpSubmittedFrame& frame, const VdpSubmittedFrameSaveState& state);

} // namespace bmsx
