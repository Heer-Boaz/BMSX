#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/bbu.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/mdu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/sbx.h"
#include "machine/devices/vdp/xf.h"
#include <vector>

namespace bmsx {

enum class VdpDexFrameState : u8 {
	Idle = 0,
	DirectOpen = 1,
	StreamOpen = 2,
};

enum class VdpSubmittedFrameState : u8 {
	Empty = 0,
	Queued = 1,
	Executing = 2,
	Ready = 3,
};

struct VdpSubmittedFrame {
	std::vector<VdpBlitterCommand> queue;
	std::vector<VdpBbuBillboardEntry> billboards;
	std::vector<VdpMduMeshEntry> meshes;
	VdpSubmittedFrameState state = VdpSubmittedFrameState::Empty;
	bool hasCommands = false;
	bool hasFrameBufferCommands = false;
	int cost = 0;
	int workRemaining = 0;
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
	VdpXfUnit xf;
	u32 skyboxControl = 0;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	VdpSkyboxSamples skyboxSamples{};
	std::array<u32, VDP_MFU_WEIGHT_COUNT> morphWeightWords{};
	std::array<u32, VDP_JTU_REGISTER_WORDS> jointMatrixWords{};
};

struct VdpBuildingFrame {
	std::vector<VdpBlitterCommand> queue;
	std::vector<VdpBbuBillboardEntry> billboards;
	std::vector<VdpMduMeshEntry> meshes;
	VdpDexFrameState state = VdpDexFrameState::Idle;
	int cost = 0;
};

struct VdpBlitterSourceSaveState {
	u32 surfaceId = 0u;
	u32 srcX = 0u;
	u32 srcY = 0u;
	u32 width = 0u;
	u32 height = 0u;
};

struct VdpGlyphRunGlyphSaveState : VdpBlitterSourceSaveState {
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
	u32 advance = 0u;
};

struct VdpTileRunBlitSaveState : VdpBlitterSourceSaveState {
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
};

struct VdpBlitterCommandSaveState {
	VdpBlitterCommandType opcode = VdpBlitterCommandType::Clear;
	u32 seq = 0u;
	int renderCost = 0;
	Layer2D layer = Layer2D::World;
	f32 priority = 0.0f;
	VdpBlitterSourceSaveState source;
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
	f32 scaleX = 1.0f;
	f32 scaleY = 1.0f;
	bool flipH = false;
	bool flipV = false;
	u32 color = 0u;
	f32 parallaxWeight = 0.0f;
	i32 srcX = 0;
	i32 srcY = 0;
	i32 width = 0;
	i32 height = 0;
	f32 x0 = 0.0f;
	f32 y0 = 0.0f;
	f32 x1 = 0.0f;
	f32 y1 = 0.0f;
	f32 thickness = 1.0f;
	bool hasBackgroundColor = false;
	u32 backgroundColor = 0u;
	u32 lineHeight = 0u;
	std::vector<VdpGlyphRunGlyphSaveState> glyphs;
	std::vector<VdpTileRunBlitSaveState> tiles;
};

struct VdpBbuBillboardSaveState {
	u32 seq = 0u;
	Layer2D layer = Layer2D::World;
	u32 priority = 0u;
	f32 positionX = 0.0f;
	f32 positionY = 0.0f;
	f32 positionZ = 0.0f;
	f32 size = 1.0f;
	u32 color = 0u;
	VdpBlitterSourceSaveState source;
	u32 surfaceWidth = 0u;
	u32 surfaceHeight = 0u;
	u32 slot = 0u;
};

struct VdpBuildingFrameSaveState {
	VdpDexFrameState state = VdpDexFrameState::Idle;
	std::vector<VdpBlitterCommandSaveState> queue;
	std::vector<VdpBbuBillboardSaveState> billboards;
	int cost = 0;
};

struct VdpSubmittedFrameSaveState {
	VdpSubmittedFrameState state = VdpSubmittedFrameState::Empty;
	std::vector<VdpBlitterCommandSaveState> queue;
	std::vector<VdpBbuBillboardSaveState> billboards;
	bool hasCommands = false;
	bool hasFrameBufferCommands = false;
	int cost = 0;
	int workRemaining = 0;
	i32 ditherType = 0;
	u32 frameBufferWidth = 0u;
	u32 frameBufferHeight = 0u;
	VdpXfState xf;
	u32 skyboxControl = 0u;
	VdpSbxUnit::FaceWords skyboxFaceWords{};
	VdpSkyboxSamples skyboxSamples{};
};

void reserveFrameStorage(VdpBuildingFrame& frame);
void reserveFrameStorage(VdpSubmittedFrame& frame);
void resetSubmittedFrameSlot(VdpSubmittedFrame& frame);
VdpBuildingFrameSaveState captureBuildingFrameState(const VdpBuildingFrame& frame);
void restoreBuildingFrameState(VdpBuildingFrame& frame, const VdpBuildingFrameSaveState& state);
VdpSubmittedFrameSaveState captureSubmittedFrameState(const VdpSubmittedFrame& frame);
void restoreSubmittedFrameState(VdpSubmittedFrame& frame, const VdpSubmittedFrameSaveState& state);

} // namespace bmsx
