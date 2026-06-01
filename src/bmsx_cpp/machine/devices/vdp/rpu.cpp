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
	VdpRpuCommandBufferSaveState state;
	state.passCount = commands.passCount;
	state.drawCount = commands.drawCount;
	state.streamBindingCount = commands.streamBindingCount;
	state.constantBindingCount = commands.constantBindingCount;
	state.textureBindingCount = commands.textureBindingCount;
	state.passFirstDraw = captureVdpRpuArrayState(commands.passFirstDraw, commands.passCount);
	state.passDrawCount = captureVdpRpuArrayState(commands.passDrawCount, commands.passCount);
	state.passColorSurfaceDescAddr = captureVdpRpuArrayState(commands.passColorSurfaceDescAddr, commands.passCount);
	state.passDepthSurfaceDescAddr = captureVdpRpuArrayState(commands.passDepthSurfaceDescAddr, commands.passCount);
	state.passViewportXY = captureVdpRpuArrayState(commands.passViewportXY, commands.passCount);
	state.passViewportWH = captureVdpRpuArrayState(commands.passViewportWH, commands.passCount);
	state.passOps = captureVdpRpuArrayState(commands.passOps, commands.passCount);
	state.passClearColor = captureVdpRpuArrayState(commands.passClearColor, commands.passCount);
	state.passClearDepthWord = captureVdpRpuArrayState(commands.passClearDepthWord, commands.passCount);
	state.drawShaderVariant = captureVdpRpuArrayState(commands.drawShaderVariant, commands.drawCount);
	state.drawPrimitive = captureVdpRpuArrayState(commands.drawPrimitive, commands.drawCount);
	state.drawPipelineWord = captureVdpRpuArrayState(commands.drawPipelineWord, commands.drawCount);
	state.drawVertexCount = captureVdpRpuArrayState(commands.drawVertexCount, commands.drawCount);
	state.drawInstanceCount = captureVdpRpuArrayState(commands.drawInstanceCount, commands.drawCount);
	state.drawIndexVramAddr = captureVdpRpuArrayState(commands.drawIndexVramAddr, commands.drawCount);
	state.drawIndexCount = captureVdpRpuArrayState(commands.drawIndexCount, commands.drawCount);
	state.drawIndexType = captureVdpRpuArrayState(commands.drawIndexType, commands.drawCount);
	state.drawFirstStreamBinding = captureVdpRpuArrayState(commands.drawFirstStreamBinding, commands.drawCount);
	state.drawStreamBindingCount = captureVdpRpuArrayState(commands.drawStreamBindingCount, commands.drawCount);
	state.drawFirstConstantBinding = captureVdpRpuArrayState(commands.drawFirstConstantBinding, commands.drawCount);
	state.drawConstantBindingCount = captureVdpRpuArrayState(commands.drawConstantBindingCount, commands.drawCount);
	state.drawFirstTextureBinding = captureVdpRpuArrayState(commands.drawFirstTextureBinding, commands.drawCount);
	state.drawTextureBindingCount = captureVdpRpuArrayState(commands.drawTextureBindingCount, commands.drawCount);
	state.streamLayoutId = captureVdpRpuArrayState(commands.streamLayoutId, commands.streamBindingCount);
	state.streamSlot = captureVdpRpuArrayState(commands.streamSlot, commands.streamBindingCount);
	state.streamVramAddr = captureVdpRpuArrayState(commands.streamVramAddr, commands.streamBindingCount);
	state.streamByteLength = captureVdpRpuArrayState(commands.streamByteLength, commands.streamBindingCount);
	state.streamStepRate = captureVdpRpuArrayState(commands.streamStepRate, commands.streamBindingCount);
	state.constantBindingSlot = captureVdpRpuArrayState(commands.constantBindingSlot, commands.constantBindingCount);
	state.constantVramAddr = captureVdpRpuArrayState(commands.constantVramAddr, commands.constantBindingCount);
	state.constantByteLength = captureVdpRpuArrayState(commands.constantByteLength, commands.constantBindingCount);
	state.textureSlot = captureVdpRpuArrayState(commands.textureSlot, commands.textureBindingCount);
	state.textureSurfaceDescAddr = captureVdpRpuArrayState(commands.textureSurfaceDescAddr, commands.textureBindingCount);
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

VdpRpuUnit::VdpRpuUnit(Memory& memory, DeviceStatusLatch& fault)
	: m_memory(memory)
	, m_fault(fault) {}

void VdpRpuUnit::reset() {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	m_buildState = VDP_RPU_FRAME_IDLE;
}

bool VdpRpuUnit::beginFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	if (m_buildState != VDP_RPU_FRAME_IDLE) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	resetVdpRpuFrameOutput(frame);
	frame.vdpVram = &vdpVram;
	m_buildState = VDP_RPU_FRAME_OPEN;
	return true;
}

void VdpRpuUnit::cancelFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	resetVdpRpuFrameOutput(frame);
	frame.vdpVram = &vdpVram;
	m_buildState = VDP_RPU_FRAME_IDLE;
}

bool VdpRpuUnit::endFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	(void)frame;
	if (m_buildState != VDP_RPU_FRAME_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	m_buildState = VDP_RPU_FRAME_IDLE;
	return true;
}

void VdpRpuUnit::rebindFrameResources(VdpRpuFrameOutput& frame) {
	frame.vdpVram = &vdpVram;
}

VdpRpuSaveState VdpRpuUnit::captureState() const {
	VdpRpuSaveState state;
	state.buildState = m_buildState;
	state.vdpVram.resize(vdpVram.size());
	for (size_t index = 0u; index < vdpVram.size(); ++index) {
		state.vdpVram[index] = vdpVram[index];
	}
	return state;
}

void VdpRpuUnit::restoreState(const VdpRpuSaveState& state) {
	m_buildState = state.buildState;
	for (size_t index = 0u; index < state.vdpVram.size(); ++index) {
		vdpVram[index] = state.vdpVram[index];
	}
}

u32 VdpRpuUnit::consumePacketFromMemory(VdpRpuFrameOutput& frame, u32 headerWord, u32 cursor, u32 end) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	if ((headerWord & 0x0000ffffu) != 0u) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_FAULT_SENTINEL;
	}
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	const u32 payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
	if (payloadWords == 0u || payloadEnd > end) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_FAULT_SENTINEL;
	}
	const u32 op = m_memory.readU32(cursor);
	return consumePacketPayloadFromMemory(frame, op, cursor, payloadWords) ? payloadEnd : VDP_RPU_FAULT_SENTINEL;
}

u32 VdpRpuUnit::consumePacketFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 headerWord, u32 cursor, u32 wordCount) {
	lastPacketCost = 0;
	lastPacketSealedFrame = false;
	if ((headerWord & 0x0000ffffu) != 0u) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_FAULT_SENTINEL;
	}
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	if (payloadWords == 0u || cursor + payloadWords > wordCount) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_FAULT_SENTINEL;
	}
	const u32 op = words[cursor];
	return consumePacketPayloadFromWords(frame, words, op, cursor, payloadWords) ? cursor + payloadWords : VDP_RPU_FAULT_SENTINEL;
}

bool VdpRpuUnit::consumePacketPayloadFromMemory(VdpRpuFrameOutput& frame, u32 op, u32 cursor, u32 payloadWords) {
	if (m_buildState == VDP_RPU_FRAME_IDLE) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
		return false;
	}
	switch (op & 0xffu) {
		case VDP_RPU_OP_EXEC_PASS_LIST:
			return payloadWords == VDP_RPU_EXEC_PASS_LIST_WORDS
				&& acceptExecPassList(frame, op, m_memory.readU32(cursor + IO_WORD_SIZE));
		case VDP_RPU_OP_SEAL_FRAME:
			return payloadWords == VDP_RPU_SEAL_FRAME_WORDS && acceptSealFrame(frame);
		default:
			m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
			return false;
	}
}

bool VdpRpuUnit::consumePacketPayloadFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 op, u32 cursor, u32 payloadWords) {
	if (m_buildState == VDP_RPU_FRAME_IDLE) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
		return false;
	}
	switch (op & 0xffu) {
		case VDP_RPU_OP_EXEC_PASS_LIST:
			return payloadWords == VDP_RPU_EXEC_PASS_LIST_WORDS
				&& acceptExecPassList(frame, op, words[cursor + 1u]);
		case VDP_RPU_OP_SEAL_FRAME:
			return payloadWords == VDP_RPU_SEAL_FRAME_WORDS && acceptSealFrame(frame);
		default:
			m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
			return false;
	}
}

bool VdpRpuUnit::acceptExecPassList(VdpRpuFrameOutput& frame, u32 opWord, u32 passDescAddr) {
	if (m_buildState != VDP_RPU_FRAME_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, opWord);
		return false;
	}
	const u32 passCount = (opWord >> 8u) & 0xffffu;
	VdpRpuCommandBuffer& cmd = frame.commands;
	const u8* vram = vdpVram.data();
	int cost = VDP_RPU_PACKET_COST;

	for (u32 p = 0u; p < passCount; ++p) {
		const u32 pb = passDescAddr + p * RPU_PASS_DESC_SIZE;
		if (!checkVramRange(pb, RPU_PASS_DESC_SIZE)) {
			return false;
		}
		if (cmd.passCount >= VDP_RPU_PASS_CAPACITY) {
			m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, static_cast<u32>(cmd.passCount));
			return false;
		}
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
			if (!checkVramRange(db, RPU_DRAW_DESC_SIZE)) {
				cmd.passDrawCount[pi] = static_cast<u16>(d);
				return false;
			}
			if (cmd.drawCount >= VDP_RPU_DRAW_CAPACITY) {
				cmd.passDrawCount[pi] = static_cast<u16>(d);
				m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, static_cast<u32>(cmd.drawCount));
				return false;
			}
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
				if (!checkVramRange(sb, RPU_STREAM_DESC_SIZE)) {
					cmd.drawStreamBindingCount[di] = static_cast<u8>(s);
					cmd.drawConstantBindingCount[di] = 0u;
					cmd.drawTextureBindingCount[di] = 0u;
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					return false;
				}
				if (cmd.streamBindingCount >= VDP_RPU_STREAM_BINDING_CAPACITY) {
					cmd.drawStreamBindingCount[di] = static_cast<u8>(s);
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, static_cast<u32>(cmd.streamBindingCount));
					return false;
				}
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
				if (!checkVramRange(cb, RPU_CONSTANT_DESC_SIZE)) {
					cmd.drawConstantBindingCount[di] = static_cast<u8>(c);
					cmd.drawTextureBindingCount[di] = 0u;
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					return false;
				}
				if (cmd.constantBindingCount >= VDP_RPU_CONSTANT_BINDING_CAPACITY) {
					cmd.drawConstantBindingCount[di] = static_cast<u8>(c);
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, static_cast<u32>(cmd.constantBindingCount));
					return false;
				}
				const size_t ci = cmd.constantBindingCount++;
				cmd.constantBindingSlot[ci] = vram[cb + RPU_CONSTANT_DESC_SLOT_OFFSET];
				cmd.constantVramAddr[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_VRAM_ADDR_OFFSET);
				cmd.constantByteLength[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_BYTE_LENGTH_OFFSET);
				cost += VDP_RPU_BIND_COST;
			}
			cmd.drawConstantBindingCount[di] = static_cast<u8>(constantCount);

			for (u32 t = 0u; t < textureCount; ++t) {
				const u32 tb = textureDescsAddr + t * RPU_TEXTURE_DESC_SIZE;
				if (!checkVramRange(tb, RPU_TEXTURE_DESC_SIZE)) {
					cmd.drawTextureBindingCount[di] = static_cast<u8>(t);
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					return false;
				}
				if (cmd.textureBindingCount >= VDP_RPU_TEXTURE_BINDING_CAPACITY) {
					cmd.drawTextureBindingCount[di] = static_cast<u8>(t);
					cmd.passDrawCount[pi] = static_cast<u16>(d + 1u);
					m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, static_cast<u32>(cmd.textureBindingCount));
					return false;
				}
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
	return true;
}

bool VdpRpuUnit::acceptSealFrame(VdpRpuFrameOutput& frame) {
	if (m_buildState != VDP_RPU_FRAME_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, VDP_RPU_OP_SEAL_FRAME);
		return false;
	}
	(void)frame;
	m_buildState = VDP_RPU_FRAME_IDLE;
	lastPacketSealedFrame = true;
	lastPacketCost = VDP_RPU_PACKET_COST;
	return true;
}

bool VdpRpuUnit::checkVramRange(u32 addr, u32 size) {
	if (addr >= VDP_RPU_PARAM_MEM_SIZE || size > VDP_RPU_PARAM_MEM_SIZE - addr) {
		m_fault.raise(VDP_FAULT_RPU_FETCH_OOB, addr);
		return false;
	}
	return true;
}

std::unique_ptr<VdpRpuFrameOutput> createVdpRpuFrameOutput() {
	return std::make_unique<VdpRpuFrameOutput>();
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
