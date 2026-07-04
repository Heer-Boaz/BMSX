#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/budget.h"
#include "machine/devices/vdp/rpu_desc.h"
#include "machine/memory/map.h"

namespace bmsx {

const VdpRpuStreamLayoutSpec& resolveVdpRpuStreamLayoutSpec(u32 layoutId) {
	switch (layoutId) {
		case VDP_RPU_LAYOUT_V2_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[1u];
		case VDP_RPU_LAYOUT_V3_C4:
			return VDP_RPU_STREAM_LAYOUTS[2u];
		case VDP_RPU_LAYOUT_V3_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[3u];
		case VDP_RPU_LAYOUT_V3_N3_C4:
			return VDP_RPU_STREAM_LAYOUTS[4u];
		case VDP_RPU_LAYOUT_V3_N3_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[5u];
		case VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4:
			return VDP_RPU_STREAM_LAYOUTS[6u];
		case VDP_RPU_LAYOUT_V3_DM3:
			return VDP_RPU_STREAM_LAYOUTS[7u];
		case VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4:
			return VDP_RPU_STREAM_LAYOUTS[8u];
		case VDP_RPU_LAYOUT_I_MAT4_C4:
			return VDP_RPU_STREAM_LAYOUTS[9u];
		case VDP_RPU_LAYOUT_V2_C4:
		default:
			return VDP_RPU_STREAM_LAYOUTS[0u];
	}
}

const VdpRpuShaderVariantSpec& resolveVdpRpuShaderVariantSpec(u32 shaderVariant) {
	return VDP_RPU_SHADER_VARIANTS[shaderVariant & VDP_RPU_SHADER_VARIANT_MASK];
}

void bumpVdpRpuVramPageRevisions(u32* pageRevisions, u32 offset, size_t byteLength) {
	if (byteLength == 0u) {
		return;
	}
	const size_t firstPage = static_cast<size_t>(offset >> VDP_RPU_PARAM_MEM_PAGE_SHIFT);
	const size_t lastPage = (static_cast<size_t>(offset) + byteLength - 1u) >> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	for (size_t page = firstPage; page <= lastPage; ++page) {
		pageRevisions[page] += 1u;
	}
}

u32 vdpRpuVramRangeRevision(const VdpRpuFrameOutput& frame, u32 vramAddr, u32 byteLength) {
	if (byteLength == 0u) {
		return 0u;
	}
	const size_t firstPage = static_cast<size_t>(vramAddr >> VDP_RPU_PARAM_MEM_PAGE_SHIFT);
	const size_t lastPage = (static_cast<size_t>(vramAddr) + byteLength - 1u) >> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	const auto& pageRevisions = frame.vdpVramPageRevisions.get();
	u32 revision = byteLength;
	for (size_t page = firstPage; page <= lastPage; ++page) {
		revision = (revision << 5u) - revision + pageRevisions[page];
	}
	return revision;
}

namespace {

template <typename T, size_t N>
std::vector<T> captureVdpRpuArrayState(const std::array<T, N>& source, size_t length) {
	std::vector<T> state;
	state.resize(length);
	for (size_t index = 0u; index < length; ++index) {
		state[index] = source[index];
	}
	return state;
}

template <typename T, size_t N>
void restoreVdpRpuArrayState(std::array<T, N>& target, const std::vector<T>& state) {
	for (size_t index = 0u; index < state.size(); ++index) {
		target[index] = state[index];
	}
}

VdpRpuCommandBufferSaveState captureVdpRpuCommandBufferState(const VdpRpuCommandBuffer& commands) {
	const size_t passCount = commands.passCount;
	const size_t drawCount = commands.drawCount;
	const size_t streamBindingCount = commands.streamBindingCount;
	const size_t constantBindingCount = commands.constantBindingCount;
	const size_t textureBindingCount = commands.textureBindingCount;
	VdpRpuCommandBufferSaveState state;
	state.passCount = passCount;
	state.drawCount = drawCount;
	state.streamBindingCount = streamBindingCount;
	state.constantBindingCount = constantBindingCount;
	state.textureBindingCount = textureBindingCount;
	state.passFirstDraw = captureVdpRpuArrayState(commands.passFirstDraw, passCount);
	state.passDrawCount = captureVdpRpuArrayState(commands.passDrawCount, passCount);
	state.passColorSurfaceDescAddr = captureVdpRpuArrayState(commands.passColorSurfaceDescAddr, passCount);
	state.passDepthSurfaceDescAddr = captureVdpRpuArrayState(commands.passDepthSurfaceDescAddr, passCount);
	state.passViewportXY = captureVdpRpuArrayState(commands.passViewportXY, passCount);
	state.passViewportWH = captureVdpRpuArrayState(commands.passViewportWH, passCount);
	state.passOps = captureVdpRpuArrayState(commands.passOps, passCount);
	state.passClearColor = captureVdpRpuArrayState(commands.passClearColor, passCount);
	state.passClearDepthWord = captureVdpRpuArrayState(commands.passClearDepthWord, passCount);
	state.drawShaderVariant = captureVdpRpuArrayState(commands.drawShaderVariant, drawCount);
	state.drawPrimitive = captureVdpRpuArrayState(commands.drawPrimitive, drawCount);
	state.drawPipelineWord = captureVdpRpuArrayState(commands.drawPipelineWord, drawCount);
	state.drawVertexCount = captureVdpRpuArrayState(commands.drawVertexCount, drawCount);
	state.drawInstanceCount = captureVdpRpuArrayState(commands.drawInstanceCount, drawCount);
	state.drawIndexVramAddr = captureVdpRpuArrayState(commands.drawIndexVramAddr, drawCount);
	state.drawIndexCount = captureVdpRpuArrayState(commands.drawIndexCount, drawCount);
	state.drawIndexType = captureVdpRpuArrayState(commands.drawIndexType, drawCount);
	state.drawFirstStreamBinding = captureVdpRpuArrayState(commands.drawFirstStreamBinding, drawCount);
	state.drawStreamBindingCount = captureVdpRpuArrayState(commands.drawStreamBindingCount, drawCount);
	state.drawFirstConstantBinding = captureVdpRpuArrayState(commands.drawFirstConstantBinding, drawCount);
	state.drawConstantBindingCount = captureVdpRpuArrayState(commands.drawConstantBindingCount, drawCount);
	state.drawFirstTextureBinding = captureVdpRpuArrayState(commands.drawFirstTextureBinding, drawCount);
	state.drawTextureBindingCount = captureVdpRpuArrayState(commands.drawTextureBindingCount, drawCount);
	state.streamLayoutId = captureVdpRpuArrayState(commands.streamLayoutId, streamBindingCount);
	state.streamSlot = captureVdpRpuArrayState(commands.streamSlot, streamBindingCount);
	state.streamVramAddr = captureVdpRpuArrayState(commands.streamVramAddr, streamBindingCount);
	state.streamByteLength = captureVdpRpuArrayState(commands.streamByteLength, streamBindingCount);
	state.streamStepRate = captureVdpRpuArrayState(commands.streamStepRate, streamBindingCount);
	state.constantBindingSlot = captureVdpRpuArrayState(commands.constantBindingSlot, constantBindingCount);
	state.constantVramAddr = captureVdpRpuArrayState(commands.constantVramAddr, constantBindingCount);
	state.constantByteLength = captureVdpRpuArrayState(commands.constantByteLength, constantBindingCount);
	state.textureSlot = captureVdpRpuArrayState(commands.textureSlot, textureBindingCount);
	state.textureSurfaceDescAddr = captureVdpRpuArrayState(commands.textureSurfaceDescAddr, textureBindingCount);
	return state;
}

void restoreVdpRpuCommandBufferState(VdpRpuCommandBuffer& commands, const VdpRpuCommandBufferSaveState& state) {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	restoreVdpRpuArrayState(commands.passFirstDraw, state.passFirstDraw);
	restoreVdpRpuArrayState(commands.passDrawCount, state.passDrawCount);
	restoreVdpRpuArrayState(commands.passColorSurfaceDescAddr, state.passColorSurfaceDescAddr);
	restoreVdpRpuArrayState(commands.passDepthSurfaceDescAddr, state.passDepthSurfaceDescAddr);
	restoreVdpRpuArrayState(commands.passViewportXY, state.passViewportXY);
	restoreVdpRpuArrayState(commands.passViewportWH, state.passViewportWH);
	restoreVdpRpuArrayState(commands.passOps, state.passOps);
	restoreVdpRpuArrayState(commands.passClearColor, state.passClearColor);
	restoreVdpRpuArrayState(commands.passClearDepthWord, state.passClearDepthWord);
	restoreVdpRpuArrayState(commands.drawShaderVariant, state.drawShaderVariant);
	restoreVdpRpuArrayState(commands.drawPrimitive, state.drawPrimitive);
	restoreVdpRpuArrayState(commands.drawPipelineWord, state.drawPipelineWord);
	restoreVdpRpuArrayState(commands.drawVertexCount, state.drawVertexCount);
	restoreVdpRpuArrayState(commands.drawInstanceCount, state.drawInstanceCount);
	restoreVdpRpuArrayState(commands.drawIndexVramAddr, state.drawIndexVramAddr);
	restoreVdpRpuArrayState(commands.drawIndexCount, state.drawIndexCount);
	restoreVdpRpuArrayState(commands.drawIndexType, state.drawIndexType);
	restoreVdpRpuArrayState(commands.drawFirstStreamBinding, state.drawFirstStreamBinding);
	restoreVdpRpuArrayState(commands.drawStreamBindingCount, state.drawStreamBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstConstantBinding, state.drawFirstConstantBinding);
	restoreVdpRpuArrayState(commands.drawConstantBindingCount, state.drawConstantBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstTextureBinding, state.drawFirstTextureBinding);
	restoreVdpRpuArrayState(commands.drawTextureBindingCount, state.drawTextureBindingCount);
	restoreVdpRpuArrayState(commands.streamLayoutId, state.streamLayoutId);
	restoreVdpRpuArrayState(commands.streamSlot, state.streamSlot);
	restoreVdpRpuArrayState(commands.streamVramAddr, state.streamVramAddr);
	restoreVdpRpuArrayState(commands.streamByteLength, state.streamByteLength);
	restoreVdpRpuArrayState(commands.streamStepRate, state.streamStepRate);
	restoreVdpRpuArrayState(commands.constantBindingSlot, state.constantBindingSlot);
	restoreVdpRpuArrayState(commands.constantVramAddr, state.constantVramAddr);
	restoreVdpRpuArrayState(commands.constantByteLength, state.constantByteLength);
	restoreVdpRpuArrayState(commands.textureSlot, state.textureSlot);
	restoreVdpRpuArrayState(commands.textureSurfaceDescAddr, state.textureSurfaceDescAddr);
}

} // namespace

VdpRpuUnit::VdpRpuUnit(Memory& memory, DeviceStatusLatch& fault, std::vector<u8>& vdpVram)
	: m_memory(memory)
	, m_fault(fault)
	, m_vdpVram(vdpVram) {}

void VdpRpuUnit::reset() {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	m_buildState = VDP_RPU_FRAME_IDLE;
}

void VdpRpuUnit::beginFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	resetVdpRpuFrameOutput(frame);
	m_buildState = VDP_RPU_FRAME_OPEN;
}

void VdpRpuUnit::cancelFrame(VdpRpuFrameOutput& frame) {
	beginFrame(frame);
	m_buildState = VDP_RPU_FRAME_IDLE;
}

void VdpRpuUnit::endFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	(void)frame;
	m_buildState = VDP_RPU_FRAME_IDLE;
}


VdpRpuSaveState VdpRpuUnit::captureState() const {
	VdpRpuSaveState state;
	state.buildState = m_buildState;
	return state;
}

void VdpRpuUnit::restoreState(const VdpRpuSaveState& state) {
	m_buildState = state.buildState;
}

u32 VdpRpuUnit::consumePacketFromMemory(VdpRpuFrameOutput& frame, u32 headerWord, u32 cursor) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	const u32 payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
	const u32 op = m_memory.readU32(cursor);
	consumePacketPayloadFromMemory(frame, op, cursor);
	return payloadEnd;
}

u32 VdpRpuUnit::consumePacketFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 headerWord, u32 cursor) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	const u32 op = words[cursor];
	consumePacketPayloadFromWords(frame, words, op, cursor);
	return cursor + payloadWords;
}

void VdpRpuUnit::consumePacketPayloadFromMemory(VdpRpuFrameOutput& frame, u32 op, u32 cursor) {
	switch (op & 0xffu) {
		case VDP_RPU_OP_EXEC_PASS_LIST:
			acceptExecPassList(frame, op, m_memory.readU32(cursor + IO_WORD_SIZE));
			return;
		case VDP_RPU_OP_SEAL_FRAME:
			acceptSealFrame(frame);
			return;
		default:
			m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
	}
}

void VdpRpuUnit::consumePacketPayloadFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 op, u32 cursor) {
	switch (op & 0xffu) {
		case VDP_RPU_OP_EXEC_PASS_LIST:
			acceptExecPassList(frame, op, words[cursor + 1u]);
			return;
		case VDP_RPU_OP_SEAL_FRAME:
			acceptSealFrame(frame);
			return;
		default:
			m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
	}
}

void VdpRpuUnit::acceptExecPassList(VdpRpuFrameOutput& frame, u32 opWord, u32 passDescAddr) {
	const u32 passCount = (opWord >> 8u) & 0xffffu;
	VdpRpuCommandBuffer& cmd = frame.commands;
	const u8* vram = m_vdpVram.data();
	int cost = VDP_RPU_PACKET_COST;

	for (u32 p = 0u; p < passCount; ++p) {
		const u32 pb = passDescAddr + p * RPU_PASS_DESC_SIZE;
		const size_t pi = cmd.passCount++;
		cost += VDP_RPU_PASS_COST;
		cmd.passColorSurfaceDescAddr[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET);
		cmd.passDepthSurfaceDescAddr[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET);
		cmd.passViewportXY[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_VIEWPORT_XY_OFFSET);
		cmd.passViewportWH[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_VIEWPORT_WH_OFFSET);
		cmd.passOps[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_OPS_OFFSET);
		cmd.passClearColor[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_CLEAR_COLOR_OFFSET);
		cmd.passClearDepthWord[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET);

		const u32 drawDescsAddr = readRpuDescU32(vram, pb + RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET);
		const u32 drawCount = readRpuDescU16(vram, pb + RPU_PASS_DESC_DRAW_COUNT_OFFSET);
		cmd.passFirstDraw[pi] = static_cast<u32>(cmd.drawCount);

		for (u32 d = 0u; d < drawCount; ++d) {
			const u32 db = drawDescsAddr + d * RPU_DRAW_DESC_SIZE;
			const size_t di = cmd.drawCount++;
			cmd.drawShaderVariant[di] = readRpuDescU16(vram, db + RPU_DRAW_DESC_SHADER_VARIANT_OFFSET);
			cmd.drawPrimitive[di] = vram[db + RPU_DRAW_DESC_PRIMITIVE_OFFSET];
			cmd.drawPipelineWord[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_PIPELINE_WORD_OFFSET);
			cmd.drawVertexCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_VERTEX_COUNT_OFFSET);
			cmd.drawInstanceCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET);
			cmd.drawIndexVramAddr[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET);
			cmd.drawIndexCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INDEX_COUNT_OFFSET);
			cmd.drawIndexType[di] = vram[db + RPU_DRAW_DESC_INDEX_TYPE_OFFSET];
			cmd.drawFirstStreamBinding[di] = static_cast<u32>(cmd.streamBindingCount);
			cmd.drawFirstConstantBinding[di] = static_cast<u32>(cmd.constantBindingCount);
			cmd.drawFirstTextureBinding[di] = static_cast<u32>(cmd.textureBindingCount);
			cost += rpuDrawCost(cmd.drawVertexCount[di], cmd.drawInstanceCount[di], cmd.drawIndexCount[di]);

			const u32 streamCount = vram[db + RPU_DRAW_DESC_STREAM_COUNT_OFFSET];
			const u32 constantCount = vram[db + RPU_DRAW_DESC_CONSTANT_COUNT_OFFSET];
			const u32 textureCount = vram[db + RPU_DRAW_DESC_TEXTURE_COUNT_OFFSET];
			const u32 streamDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET);
			const u32 constantDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET);
			const u32 textureDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET);

			for (u32 s = 0u; s < streamCount; ++s) {
				const u32 sb = streamDescsAddr + s * RPU_STREAM_DESC_SIZE;
				const size_t si = cmd.streamBindingCount++;
				cmd.streamVramAddr[si] = readRpuDescU32(vram, sb + RPU_STREAM_DESC_VRAM_ADDR_OFFSET);
				cmd.streamByteLength[si] = readRpuDescU32(vram, sb + RPU_STREAM_DESC_BYTE_LENGTH_OFFSET);
				cmd.streamLayoutId[si] = readRpuDescU16(vram, sb + RPU_STREAM_DESC_LAYOUT_ID_OFFSET);
				cmd.streamSlot[si] = vram[sb + RPU_STREAM_DESC_SLOT_OFFSET];
				cmd.streamStepRate[si] = vram[sb + RPU_STREAM_DESC_STEP_RATE_OFFSET];
				cost += VDP_RPU_BIND_COST;
			}
			cmd.drawStreamBindingCount[di] = static_cast<u8>(streamCount);

			for (u32 c = 0u; c < constantCount; ++c) {
				const u32 cb = constantDescsAddr + c * RPU_CONSTANT_DESC_SIZE;
				const size_t ci = cmd.constantBindingCount++;
				cmd.constantBindingSlot[ci] = vram[cb + RPU_CONSTANT_DESC_SLOT_OFFSET];
				cmd.constantVramAddr[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_VRAM_ADDR_OFFSET);
				cmd.constantByteLength[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_BYTE_LENGTH_OFFSET);
				cost += VDP_RPU_BIND_COST;
			}
			cmd.drawConstantBindingCount[di] = static_cast<u8>(constantCount);

			for (u32 t = 0u; t < textureCount; ++t) {
				const u32 tb = textureDescsAddr + t * RPU_TEXTURE_DESC_SIZE;
				const size_t ti = cmd.textureBindingCount++;
				cmd.textureSlot[ti] = vram[tb + RPU_TEXTURE_DESC_SLOT_OFFSET];
				cmd.textureSurfaceDescAddr[ti] = readRpuDescU32(vram, tb + RPU_TEXTURE_DESC_SURFACE_DESC_ADDR_OFFSET);
				cost += VDP_RPU_BIND_COST;
			}
			cmd.drawTextureBindingCount[di] = static_cast<u8>(textureCount);
		}
		cmd.passDrawCount[pi] = static_cast<u16>(drawCount);
	}

	lastPacketCost = cost;
}

void VdpRpuUnit::acceptSealFrame(VdpRpuFrameOutput& frame) {
	(void)frame;
	m_buildState = VDP_RPU_FRAME_IDLE;
	lastPacketSealedFrame = true;
	lastPacketCost = VDP_RPU_PACKET_COST;
}

std::unique_ptr<VdpRpuFrameOutput> createVdpRpuFrameOutput(std::vector<u8>& vdpVram, std::vector<u32>& vdpVramPageRevisions) {
	return std::make_unique<VdpRpuFrameOutput>(VdpRpuFrameOutput{.vdpVram = vdpVram, .vdpVramPageRevisions = vdpVramPageRevisions});
}

void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame) {
	frame.commands.passCount = 0u;
	frame.commands.drawCount = 0u;
	frame.commands.streamBindingCount = 0u;
	frame.commands.constantBindingCount = 0u;
	frame.commands.textureBindingCount = 0u;
}

VdpRpuFrameSaveState captureVdpRpuFrameState(const VdpRpuFrameOutput& frame) {
	VdpRpuFrameSaveState state;
	state.commands = captureVdpRpuCommandBufferState(frame.commands);
	return state;
}

void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state) {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
}

} // namespace bmsx
