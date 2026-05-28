#include "machine/devices/vdp/rpu.h"
#include "machine/devices/vdp/budget.h"
#include "common/fixed_point.h"
#include "machine/memory/map.h"

#include <bit>

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

VdpRpuFrameBufferRefs::VdpRpuFrameBufferRefs() {
	for (size_t index = 0u; index < bytes.size(); ++index) {
		bytes[index] = nullptr;
	}
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
	state.drawBatchCount = commands.drawBatchCount;
	state.streamBindingCount = commands.streamBindingCount;
	state.constantBindingCount = commands.constantBindingCount;
	state.textureBindingCount = commands.textureBindingCount;
	state.passFirstDraw = captureVdpRpuArrayState(commands.passFirstDraw, commands.passCount);
	state.passDrawCount = captureVdpRpuArrayState(commands.passDrawCount, commands.passCount);
	state.passFirstBatch = captureVdpRpuArrayState(commands.passFirstBatch, commands.passCount);
	state.passBatchCount = captureVdpRpuArrayState(commands.passBatchCount, commands.passCount);
	state.passColorSurfaceRef = captureVdpRpuArrayState(commands.passColorSurfaceRef, commands.passCount);
	state.passDepthSurfaceRef = captureVdpRpuArrayState(commands.passDepthSurfaceRef, commands.passCount);
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
	state.drawIndexBufferRef = captureVdpRpuArrayState(commands.drawIndexBufferRef, commands.drawCount);
	state.drawIndexByteOffset = captureVdpRpuArrayState(commands.drawIndexByteOffset, commands.drawCount);
	state.drawIndexCount = captureVdpRpuArrayState(commands.drawIndexCount, commands.drawCount);
	state.drawIndexType = captureVdpRpuArrayState(commands.drawIndexType, commands.drawCount);
	state.drawFirstStreamBinding = captureVdpRpuArrayState(commands.drawFirstStreamBinding, commands.drawCount);
	state.drawStreamBindingCount = captureVdpRpuArrayState(commands.drawStreamBindingCount, commands.drawCount);
	state.drawFirstConstantBinding = captureVdpRpuArrayState(commands.drawFirstConstantBinding, commands.drawCount);
	state.drawConstantBindingCount = captureVdpRpuArrayState(commands.drawConstantBindingCount, commands.drawCount);
	state.drawFirstTextureBinding = captureVdpRpuArrayState(commands.drawFirstTextureBinding, commands.drawCount);
	state.drawTextureBindingCount = captureVdpRpuArrayState(commands.drawTextureBindingCount, commands.drawCount);
	state.batchFirstDraw = captureVdpRpuArrayState(commands.batchFirstDraw, commands.drawBatchCount);
	state.batchDrawCount = captureVdpRpuArrayState(commands.batchDrawCount, commands.drawBatchCount);
	state.batchVertexCount = captureVdpRpuArrayState(commands.batchVertexCount, commands.drawBatchCount);
	state.batchInstanceCount = captureVdpRpuArrayState(commands.batchInstanceCount, commands.drawBatchCount);
	state.batchIndexCount = captureVdpRpuArrayState(commands.batchIndexCount, commands.drawBatchCount);
	state.streamLayoutId = captureVdpRpuArrayState(commands.streamLayoutId, commands.streamBindingCount);
	state.streamSlot = captureVdpRpuArrayState(commands.streamSlot, commands.streamBindingCount);
	state.streamBufferRef = captureVdpRpuArrayState(commands.streamBufferRef, commands.streamBindingCount);
	state.streamByteOffset = captureVdpRpuArrayState(commands.streamByteOffset, commands.streamBindingCount);
	state.streamStepRate = captureVdpRpuArrayState(commands.streamStepRate, commands.streamBindingCount);
	state.constantBindingSlot = captureVdpRpuArrayState(commands.constantBindingSlot, commands.constantBindingCount);
	state.constantBank = captureVdpRpuArrayState(commands.constantBank, commands.constantBindingCount);
	state.constantFirstWord = captureVdpRpuArrayState(commands.constantFirstWord, commands.constantBindingCount);
	state.constantWordCount = captureVdpRpuArrayState(commands.constantWordCount, commands.constantBindingCount);
	state.textureSlot = captureVdpRpuArrayState(commands.textureSlot, commands.textureBindingCount);
	state.textureSurfaceRef = captureVdpRpuArrayState(commands.textureSurfaceRef, commands.textureBindingCount);
	state.textureSamplerWord = captureVdpRpuArrayState(commands.textureSamplerWord, commands.textureBindingCount);
	return state;
}

void restoreVdpRpuCommandBufferState(VdpRpuCommandBuffer& commands, const VdpRpuCommandBufferSaveState& state) {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.drawBatchCount = state.drawBatchCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	restoreVdpRpuArrayState(commands.passFirstDraw, state.passFirstDraw);
	restoreVdpRpuArrayState(commands.passDrawCount, state.passDrawCount);
	restoreVdpRpuArrayState(commands.passFirstBatch, state.passFirstBatch);
	restoreVdpRpuArrayState(commands.passBatchCount, state.passBatchCount);
	restoreVdpRpuArrayState(commands.passColorSurfaceRef, state.passColorSurfaceRef);
	restoreVdpRpuArrayState(commands.passDepthSurfaceRef, state.passDepthSurfaceRef);
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
	restoreVdpRpuArrayState(commands.drawIndexBufferRef, state.drawIndexBufferRef);
	restoreVdpRpuArrayState(commands.drawIndexByteOffset, state.drawIndexByteOffset);
	restoreVdpRpuArrayState(commands.drawIndexCount, state.drawIndexCount);
	restoreVdpRpuArrayState(commands.drawIndexType, state.drawIndexType);
	restoreVdpRpuArrayState(commands.drawFirstStreamBinding, state.drawFirstStreamBinding);
	restoreVdpRpuArrayState(commands.drawStreamBindingCount, state.drawStreamBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstConstantBinding, state.drawFirstConstantBinding);
	restoreVdpRpuArrayState(commands.drawConstantBindingCount, state.drawConstantBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstTextureBinding, state.drawFirstTextureBinding);
	restoreVdpRpuArrayState(commands.drawTextureBindingCount, state.drawTextureBindingCount);
	restoreVdpRpuArrayState(commands.batchFirstDraw, state.batchFirstDraw);
	restoreVdpRpuArrayState(commands.batchDrawCount, state.batchDrawCount);
	restoreVdpRpuArrayState(commands.batchVertexCount, state.batchVertexCount);
	restoreVdpRpuArrayState(commands.batchInstanceCount, state.batchInstanceCount);
	restoreVdpRpuArrayState(commands.batchIndexCount, state.batchIndexCount);
	restoreVdpRpuArrayState(commands.streamLayoutId, state.streamLayoutId);
	restoreVdpRpuArrayState(commands.streamSlot, state.streamSlot);
	restoreVdpRpuArrayState(commands.streamBufferRef, state.streamBufferRef);
	restoreVdpRpuArrayState(commands.streamByteOffset, state.streamByteOffset);
	restoreVdpRpuArrayState(commands.streamStepRate, state.streamStepRate);
	restoreVdpRpuArrayState(commands.constantBindingSlot, state.constantBindingSlot);
	restoreVdpRpuArrayState(commands.constantBank, state.constantBank);
	restoreVdpRpuArrayState(commands.constantFirstWord, state.constantFirstWord);
	restoreVdpRpuArrayState(commands.constantWordCount, state.constantWordCount);
	restoreVdpRpuArrayState(commands.textureSlot, state.textureSlot);
	restoreVdpRpuArrayState(commands.textureSurfaceRef, state.textureSurfaceRef);
	restoreVdpRpuArrayState(commands.textureSamplerWord, state.textureSamplerWord);
}

std::vector<VdpRpuFrameBufferRefSaveState> captureVdpRpuFrameBufferRefsState(const VdpRpuFrameBufferRefs& refs) {
	std::vector<VdpRpuFrameBufferRefSaveState> states;
	states.resize(refs.length);
	for (size_t index = 0u; index < refs.length; ++index) {
		states[index] = VdpRpuFrameBufferRefSaveState{
			refs.bufferId[index],
			refs.revision[index],
			refs.sourceByteOffset[index],
			refs.byteOffset[index],
			refs.byteLength[index],
			refs.usage[index],
		};
	}
	return states;
}

void restoreVdpRpuFrameBufferRefsState(VdpRpuFrameBufferRefs& refs, const std::vector<VdpRpuFrameBufferRefSaveState>& states) {
	refs.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		const VdpRpuFrameBufferRefSaveState& state = states[index];
		refs.bufferId[index] = state.bufferId;
		refs.revision[index] = state.revision;
		refs.sourceByteOffset[index] = state.sourceByteOffset;
		refs.byteOffset[index] = state.byteOffset;
		refs.byteLength[index] = state.byteLength;
		refs.usage[index] = static_cast<u8>(state.usage);
	}
}

std::vector<VdpRpuFrameSurfaceRefSaveState> captureVdpRpuFrameSurfaceRefsState(const VdpRpuFrameSurfaceRefs& refs) {
	std::vector<VdpRpuFrameSurfaceRefSaveState> states;
	states.resize(refs.length);
	for (size_t index = 0u; index < refs.length; ++index) {
		states[index] = VdpRpuFrameSurfaceRefSaveState{
			refs.surfaceId[index],
			refs.revision[index],
			refs.width[index],
			refs.height[index],
			refs.format[index],
			refs.usage[index],
		};
	}
	return states;
}

void restoreVdpRpuFrameSurfaceRefsState(VdpRpuFrameSurfaceRefs& refs, const std::vector<VdpRpuFrameSurfaceRefSaveState>& states) {
	refs.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		const VdpRpuFrameSurfaceRefSaveState& state = states[index];
		refs.surfaceId[index] = state.surfaceId;
		refs.revision[index] = state.revision;
		refs.width[index] = static_cast<u16>(state.width);
		refs.height[index] = static_cast<u16>(state.height);
		refs.format[index] = static_cast<u8>(state.format);
		refs.usage[index] = static_cast<u8>(state.usage);
	}
}

std::vector<VdpRpuConstantBankSaveState> captureVdpRpuConstantBankState(const VdpRpuConstantBankTable& banks) {
	std::vector<VdpRpuConstantBankSaveState> states;
	states.resize(banks.length);
	for (size_t index = 0u; index < banks.length; ++index) {
		states[index] = VdpRpuConstantBankSaveState{
			banks.firstWord[index],
			banks.wordCount[index],
			banks.epoch[index],
		};
	}
	return states;
}

void restoreVdpRpuConstantBankState(VdpRpuConstantBankTable& banks, const std::vector<VdpRpuConstantBankSaveState>& states) {
	banks.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		const VdpRpuConstantBankSaveState& state = states[index];
		banks.firstWord[index] = state.firstWord;
		banks.wordCount[index] = static_cast<u16>(state.wordCount);
		banks.epoch[index] = state.epoch;
	}
}

std::vector<u32> captureVdpRpuConstantWords(const VdpRpuFrameOutput& frame) {
	size_t wordCount = 0u;
	const VdpRpuConstantBankTable& banks = frame.resources.constantBanks;
	for (size_t index = 0u; index < banks.length; ++index) {
		const size_t bankEnd = banks.firstWord[index] + banks.wordCount[index];
		if (bankEnd > wordCount) {
			wordCount = bankEnd;
		}
	}
	std::vector<u32> words;
	words = captureVdpRpuArrayState(frame.resources.constantWords, wordCount);
	return words;
}

} // namespace

VdpRpuUnit::VdpRpuUnit(
	Memory& memory,
	DeviceStatusLatch& fault,
	const std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>& xfMatrixWords,
	const std::array<u32, VDP_LPU_REGISTER_WORDS>& lightRegisterWords,
	const std::array<u32, VDP_MFU_WEIGHT_COUNT>& morphWeightWords,
	const std::array<u32, VDP_JTU_REGISTER_WORDS>& jointMatrixWords
)
	: m_memory(memory)
	, m_fault(fault)
	, m_xfMatrixWords(xfMatrixWords)
	, m_lightRegisterWords(lightRegisterWords)
	, m_morphWeightWords(morphWeightWords)
	, m_jointMatrixWords(jointMatrixWords)
	, m_bufferBytes(VDP_RPU_BUFFER_BYTE_CAPACITY) {}

void VdpRpuUnit::reset() {
	lastPacketCost = 0;
	m_buildState = VDP_RPU_FRAME_IDLE;
	m_openPassIndex = 0u;
	m_openDrawIndex = 0u;
	for (size_t bufferId = 0u; bufferId < VDP_RPU_BUFFER_CAPACITY; ++bufferId) {
		m_bufferDefined[bufferId] = 0u;
		m_bufferRevision[bufferId] = 0u;
		m_bufferByteLength[bufferId] = 0u;
		m_bufferUsage[bufferId] = 0u;
	}
	for (size_t surfaceId = 0u; surfaceId < VDP_RPU_SURFACE_CAPACITY; ++surfaceId) {
		m_surfaceDefined[surfaceId] = 0u;
		m_surfaceRevision[surfaceId] = 0u;
		m_surfaceWidth[surfaceId] = 0u;
		m_surfaceHeight[surfaceId] = 0u;
		m_surfaceFormat[surfaceId] = 0u;
		m_surfaceUsage[surfaceId] = 0u;
	}
}

bool VdpRpuUnit::beginFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	if (m_buildState != VDP_RPU_FRAME_IDLE) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	resetVdpRpuFrameOutput(frame);
	m_buildState = VDP_RPU_FRAME_OPEN;
	m_openPassIndex = 0u;
	m_openDrawIndex = 0u;
	return true;
}

void VdpRpuUnit::cancelFrame(VdpRpuFrameOutput& frame) {
	lastPacketCost = 0;
	resetVdpRpuFrameOutput(frame);
	m_buildState = VDP_RPU_FRAME_IDLE;
	m_openPassIndex = 0u;
	m_openDrawIndex = 0u;
}

bool VdpRpuUnit::endFrame(VdpRpuFrameOutput& frame) {
	(void)frame;
	lastPacketCost = 0;
	if (m_buildState == VDP_RPU_DRAW_OPEN || m_buildState == VDP_RPU_PASS_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	if (m_buildState != VDP_RPU_FRAME_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	m_buildState = VDP_RPU_FRAME_IDLE;
	m_openPassIndex = 0u;
	m_openDrawIndex = 0u;
	return true;
}

VdpRpuSaveState VdpRpuUnit::captureState() const {
	VdpRpuSaveState state;
	state.buildState = m_buildState;
	state.openPassIndex = m_openPassIndex;
	state.openDrawIndex = m_openDrawIndex;
	size_t bufferCount = 0u;
	for (u32 bufferId = 0u; bufferId < VDP_RPU_BUFFER_CAPACITY; ++bufferId) {
		if (m_bufferDefined[bufferId] != 0u) {
			++bufferCount;
		}
	}
	size_t surfaceCount = 0u;
	for (u32 surfaceId = 0u; surfaceId < VDP_RPU_SURFACE_CAPACITY; ++surfaceId) {
		if (m_surfaceDefined[surfaceId] != 0u) {
			++surfaceCount;
		}
	}
	state.buffers.resize(bufferCount);
	state.bufferImages.resize(bufferCount);
	state.surfaces.resize(surfaceCount);
	size_t bufferIndex = 0u;
	for (u32 bufferId = 0u; bufferId < VDP_RPU_BUFFER_CAPACITY; ++bufferId) {
		if (m_bufferDefined[bufferId] != 0u) {
			const u32 byteLength = m_bufferByteLength[bufferId];
			VdpRpuBufferImageSaveState& image = state.bufferImages[bufferIndex];
			image.bufferId = bufferId;
			image.bytes.resize(byteLength);
			const u32 byteBase = bufferByteBase(bufferId);
			for (u32 byteIndex = 0u; byteIndex < byteLength; ++byteIndex) {
				image.bytes[byteIndex] = m_bufferBytes[byteBase + byteIndex];
			}
			state.buffers[bufferIndex] = VdpRpuBufferRecordSaveState{
				bufferId,
				m_bufferRevision[bufferId],
				byteLength,
				m_bufferUsage[bufferId],
			};
			++bufferIndex;
		}
	}
	size_t surfaceIndex = 0u;
	for (u32 surfaceId = 0u; surfaceId < VDP_RPU_SURFACE_CAPACITY; ++surfaceId) {
		if (m_surfaceDefined[surfaceId] != 0u) {
			state.surfaces[surfaceIndex] = VdpRpuSurfaceRecordSaveState{
				surfaceId,
				m_surfaceRevision[surfaceId],
				m_surfaceWidth[surfaceId],
				m_surfaceHeight[surfaceId],
				m_surfaceFormat[surfaceId],
				m_surfaceUsage[surfaceId],
			};
			++surfaceIndex;
		}
	}
	return state;
}

void VdpRpuUnit::restoreState(const VdpRpuSaveState& state) {
	reset();
	m_buildState = state.buildState;
	m_openPassIndex = state.openPassIndex;
	m_openDrawIndex = state.openDrawIndex;
	for (const VdpRpuBufferRecordSaveState& buffer : state.buffers) {
		m_bufferDefined[buffer.bufferId] = 1u;
		m_bufferRevision[buffer.bufferId] = buffer.liveRevision;
		m_bufferByteLength[buffer.bufferId] = buffer.byteLength;
		m_bufferUsage[buffer.bufferId] = buffer.usage;
	}
	for (const VdpRpuBufferImageSaveState& image : state.bufferImages) {
		const u32 byteBase = bufferByteBase(image.bufferId);
		for (size_t byteIndex = 0u; byteIndex < image.bytes.size(); ++byteIndex) {
			m_bufferBytes[byteBase + byteIndex] = image.bytes[byteIndex];
		}
	}
	for (const VdpRpuSurfaceRecordSaveState& surface : state.surfaces) {
		m_surfaceDefined[surface.surfaceId] = 1u;
		m_surfaceRevision[surface.surfaceId] = surface.liveRevision;
		m_surfaceWidth[surface.surfaceId] = static_cast<u16>(surface.width);
		m_surfaceHeight[surface.surfaceId] = static_cast<u16>(surface.height);
		m_surfaceFormat[surface.surfaceId] = static_cast<u8>(surface.format);
		m_surfaceUsage[surface.surfaceId] = static_cast<u8>(surface.usage);
	}
}

void VdpRpuUnit::rebindFrameResources(VdpRpuFrameOutput& frame) {
	for (size_t index = 0u; index < frame.resources.bufferRefs.length; ++index) {
		frame.resources.bufferRefs.bytes[index] = frame.resources.bufferRefs.snapshotBytes.data();
	}
}

u32 VdpRpuUnit::consumePacketFromMemory(VdpRpuFrameOutput& frame, u32 headerWord, u32 cursor, u32 end) {
	lastPacketCost = 0;
	if ((headerWord & 0x0000ffffu) != 0u) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_RESOURCE_NONE;
	}
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	const u32 payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
	if (payloadWords == 0u || payloadEnd > end) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_RESOURCE_NONE;
	}
	const u32 op = m_memory.readU32(cursor);
	return consumePacketPayloadFromMemory(frame, op, cursor, payloadWords) ? payloadEnd : VDP_RPU_RESOURCE_NONE;
}

u32 VdpRpuUnit::consumePacketFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 headerWord, u32 cursor, u32 wordCount) {
	lastPacketCost = 0;
	if ((headerWord & 0x0000ffffu) != 0u) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_RESOURCE_NONE;
	}
	const u32 payloadWords = (headerWord >> 16u) & 0xffu;
	if (payloadWords == 0u || cursor + payloadWords > wordCount) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
		return VDP_RPU_RESOURCE_NONE;
	}
	const u32 op = words[cursor];
	return consumePacketPayloadFromWords(frame, words, op, cursor, payloadWords) ? cursor + payloadWords : VDP_RPU_RESOURCE_NONE;
}

bool VdpRpuUnit::consumePacketPayloadFromMemory(VdpRpuFrameOutput& frame, u32 op, u32 cursor, u32 payloadWords) {
	if (m_buildState == VDP_RPU_FRAME_IDLE) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
		return false;
	}
	switch (op) {
		case VDP_RPU_OP_BUFFER_DEFINE:
			return payloadWords == VDP_RPU_BUFFER_DEFINE_WORDS && acceptBufferDefine(m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u));
		case VDP_RPU_OP_BUFFER_UPLOAD_DMA:
			return payloadWords == VDP_RPU_BUFFER_UPLOAD_DMA_WORDS && acceptBufferUploadDma(m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u));
		case VDP_RPU_OP_BUFFER_UPLOAD_INLINE:
			return acceptBufferUploadInlineFromMemory(cursor, payloadWords);
		case VDP_RPU_OP_BUFFER_DISCARD:
			return payloadWords == VDP_RPU_BUFFER_DISCARD_WORDS && acceptBufferDiscard(m_memory.readU32(cursor + IO_WORD_SIZE));
		case VDP_RPU_OP_SURFACE_DEFINE:
			return payloadWords == VDP_RPU_SURFACE_DEFINE_WORDS && acceptSurfaceDefine(m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u));
		case VDP_RPU_OP_CONSTANT_BANK_DEFINE:
			return payloadWords == VDP_RPU_CONSTANT_BANK_DEFINE_WORDS && acceptConstantBankDefine(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u));
		case VDP_RPU_OP_CONSTANT_UPLOAD_DMA:
			return payloadWords == VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS && acceptConstantUploadDma(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u));
		case VDP_RPU_OP_CONSTANT_UPLOAD_INLINE:
			return acceptConstantUploadInlineFromMemory(frame, cursor, payloadWords);
		case VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE:
			return payloadWords == VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS && acceptConstantUploadDevice(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u), m_memory.readU32(cursor + IO_WORD_SIZE * 5u));
		case VDP_RPU_OP_BEGIN_PASS:
			return payloadWords == VDP_RPU_BEGIN_PASS_WORDS && acceptBeginPass(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u), m_memory.readU32(cursor + IO_WORD_SIZE * 5u), m_memory.readU32(cursor + IO_WORD_SIZE * 6u), m_memory.readU32(cursor + IO_WORD_SIZE * 7u));
		case VDP_RPU_OP_END_PASS:
			return payloadWords == VDP_RPU_END_PASS_WORDS && acceptEndPass(frame);
		case VDP_RPU_OP_BEGIN_DRAW:
			return payloadWords == VDP_RPU_BEGIN_DRAW_WORDS && acceptBeginDraw(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u), m_memory.readU32(cursor + IO_WORD_SIZE * 5u), m_memory.readU32(cursor + IO_WORD_SIZE * 6u), m_memory.readU32(cursor + IO_WORD_SIZE * 7u), m_memory.readU32(cursor + IO_WORD_SIZE * 8u));
		case VDP_RPU_OP_BIND_STREAM:
			return payloadWords == VDP_RPU_BIND_STREAM_WORDS && acceptBindStream(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u), m_memory.readU32(cursor + IO_WORD_SIZE * 5u));
		case VDP_RPU_OP_BIND_CONSTANTS:
			return payloadWords == VDP_RPU_BIND_CONSTANTS_WORDS && acceptBindConstants(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u), m_memory.readU32(cursor + IO_WORD_SIZE * 4u));
		case VDP_RPU_OP_BIND_TEXTURE:
			return payloadWords == VDP_RPU_BIND_TEXTURE_WORDS && acceptBindTexture(frame, m_memory.readU32(cursor + IO_WORD_SIZE), m_memory.readU32(cursor + IO_WORD_SIZE * 2u), m_memory.readU32(cursor + IO_WORD_SIZE * 3u));
		case VDP_RPU_OP_END_DRAW:
			return payloadWords == VDP_RPU_END_DRAW_WORDS && acceptEndDraw(frame);
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
	switch (op) {
		case VDP_RPU_OP_BUFFER_DEFINE:
			return payloadWords == VDP_RPU_BUFFER_DEFINE_WORDS && acceptBufferDefine(words[cursor + 1u], words[cursor + 2u], words[cursor + 3u]);
		case VDP_RPU_OP_BUFFER_UPLOAD_DMA:
			return payloadWords == VDP_RPU_BUFFER_UPLOAD_DMA_WORDS && acceptBufferUploadDma(words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u]);
		case VDP_RPU_OP_BUFFER_UPLOAD_INLINE:
			return acceptBufferUploadInlineFromWords(words, cursor, payloadWords);
		case VDP_RPU_OP_BUFFER_DISCARD:
			return payloadWords == VDP_RPU_BUFFER_DISCARD_WORDS && acceptBufferDiscard(words[cursor + 1u]);
		case VDP_RPU_OP_SURFACE_DEFINE:
			return payloadWords == VDP_RPU_SURFACE_DEFINE_WORDS && acceptSurfaceDefine(words[cursor + 1u], words[cursor + 2u], words[cursor + 3u]);
		case VDP_RPU_OP_CONSTANT_BANK_DEFINE:
			return payloadWords == VDP_RPU_CONSTANT_BANK_DEFINE_WORDS && acceptConstantBankDefine(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u]);
		case VDP_RPU_OP_CONSTANT_UPLOAD_DMA:
			return payloadWords == VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS && acceptConstantUploadDma(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u]);
		case VDP_RPU_OP_CONSTANT_UPLOAD_INLINE:
			return acceptConstantUploadInlineFromWords(frame, words, cursor, payloadWords);
		case VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE:
			return payloadWords == VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS && acceptConstantUploadDevice(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u], words[cursor + 5u]);
		case VDP_RPU_OP_BEGIN_PASS:
			return payloadWords == VDP_RPU_BEGIN_PASS_WORDS && acceptBeginPass(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u], words[cursor + 5u], words[cursor + 6u], words[cursor + 7u]);
		case VDP_RPU_OP_END_PASS:
			return payloadWords == VDP_RPU_END_PASS_WORDS && acceptEndPass(frame);
		case VDP_RPU_OP_BEGIN_DRAW:
			return payloadWords == VDP_RPU_BEGIN_DRAW_WORDS && acceptBeginDraw(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u], words[cursor + 5u], words[cursor + 6u], words[cursor + 7u], words[cursor + 8u]);
		case VDP_RPU_OP_BIND_STREAM:
			return payloadWords == VDP_RPU_BIND_STREAM_WORDS && acceptBindStream(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u], words[cursor + 5u]);
		case VDP_RPU_OP_BIND_CONSTANTS:
			return payloadWords == VDP_RPU_BIND_CONSTANTS_WORDS && acceptBindConstants(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u], words[cursor + 4u]);
		case VDP_RPU_OP_BIND_TEXTURE:
			return payloadWords == VDP_RPU_BIND_TEXTURE_WORDS && acceptBindTexture(frame, words[cursor + 1u], words[cursor + 2u], words[cursor + 3u]);
		case VDP_RPU_OP_END_DRAW:
			return payloadWords == VDP_RPU_END_DRAW_WORDS && acceptEndDraw(frame);
		default:
			m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
			return false;
	}
}

bool VdpRpuUnit::acceptBufferDefine(u32 bufferId, u32 byteLength, u32 usage) {
	if (bufferId >= VDP_RPU_BUFFER_CAPACITY || byteLength == 0u || byteLength > VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, bufferId);
		return false;
	}
	m_bufferDefined[bufferId] = 1u;
	m_bufferRevision[bufferId] += 1u;
	m_bufferByteLength[bufferId] = byteLength;
	m_bufferUsage[bufferId] = usage;
	lastPacketCost = VDP_RPU_RESOURCE_COST;
	return true;
}

bool VdpRpuUnit::acceptBufferUploadDma(u32 bufferId, u32 dstByteOffset, u32 srcAddr, u32 byteLength) {
	if (!acceptBufferRange(bufferId, dstByteOffset, byteLength) || !m_memory.isReadableMainMemoryRange(srcAddr, byteLength)) {
		m_fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
		return false;
	}
	if (!m_memory.readBytes(srcAddr, m_bufferBytes.data() + bufferByteBase(bufferId) + dstByteOffset, byteLength)) {
		m_fault.raise(VDP_FAULT_RPU_BUFFER_OOB, srcAddr);
		return false;
	}
	m_bufferRevision[bufferId] += 1u;
	lastPacketCost = rpuUploadCost(byteLength);
	return true;
}

bool VdpRpuUnit::acceptBufferUploadInlineFromMemory(u32 cursor, u32 payloadWords) {
	if (payloadWords < VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	const u32 bufferId = m_memory.readU32(cursor + IO_WORD_SIZE);
	const u32 dstByteOffset = m_memory.readU32(cursor + IO_WORD_SIZE * 2u);
	const u32 byteLength = m_memory.readU32(cursor + IO_WORD_SIZE * 3u);
	const u32 dataWords = (byteLength + 3u) >> 2u;
	if (payloadWords != VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + dataWords) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	if (!acceptBufferRange(bufferId, dstByteOffset, byteLength)) {
		m_fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
		return false;
	}
	for (u32 index = 0u; index < dataWords; ++index) {
		writeInlineBufferWord(bufferByteBase(bufferId) + dstByteOffset, index, m_memory.readU32(cursor + IO_WORD_SIZE * (VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + index)), byteLength);
	}
	m_bufferRevision[bufferId] += 1u;
	lastPacketCost = rpuUploadCost(byteLength);
	return true;
}

bool VdpRpuUnit::acceptBufferUploadInlineFromWords(const u32* words, u32 cursor, u32 payloadWords) {
	if (payloadWords < VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	const u32 bufferId = words[cursor + 1u];
	const u32 dstByteOffset = words[cursor + 2u];
	const u32 byteLength = words[cursor + 3u];
	const u32 dataWords = (byteLength + 3u) >> 2u;
	if (payloadWords != VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + dataWords) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	if (!acceptBufferRange(bufferId, dstByteOffset, byteLength)) {
		m_fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
		return false;
	}
	for (u32 index = 0u; index < dataWords; ++index) {
		writeInlineBufferWord(bufferByteBase(bufferId) + dstByteOffset, index, words[cursor + VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + index], byteLength);
	}
	m_bufferRevision[bufferId] += 1u;
	lastPacketCost = rpuUploadCost(byteLength);
	return true;
}

void VdpRpuUnit::writeInlineBufferWord(u32 dstByteOffset, u32 wordIndex, u32 word, u32 byteLength) {
	const u32 byteBase = wordIndex << 2u;
	const u32 dst = dstByteOffset + byteBase;
	if (byteBase < byteLength) {
		m_bufferBytes[dst] = static_cast<u8>(word & 0xffu);
	}
	if (byteBase + 1u < byteLength) {
		m_bufferBytes[dst + 1u] = static_cast<u8>((word >> 8u) & 0xffu);
	}
	if (byteBase + 2u < byteLength) {
		m_bufferBytes[dst + 2u] = static_cast<u8>((word >> 16u) & 0xffu);
	}
	if (byteBase + 3u < byteLength) {
		m_bufferBytes[dst + 3u] = static_cast<u8>((word >> 24u) & 0xffu);
	}
}

bool VdpRpuUnit::acceptBufferDiscard(u32 bufferId) {
	if (bufferId >= VDP_RPU_BUFFER_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, bufferId);
		return false;
	}
	m_bufferDefined[bufferId] = 0u;
	m_bufferRevision[bufferId] += 1u;
	m_bufferByteLength[bufferId] = 0u;
	m_bufferUsage[bufferId] = 0u;
	lastPacketCost = VDP_RPU_DISCARD_COST;
	return true;
}

bool VdpRpuUnit::acceptSurfaceDefine(u32 surfaceId, u32 widthHeight, u32 formatUsage) {
	const u32 width = packedLow16(widthHeight);
	const u32 height = packedHigh16(widthHeight);
	const u32 format = formatUsage & VDP_RPU_FORMAT_MASK;
	const u32 usage = (formatUsage >> VDP_RPU_USAGE_SHIFT) & 0xffu;
	if (surfaceId >= VDP_RPU_SURFACE_CAPACITY || width == 0u || height == 0u) {
		m_fault.raise(VDP_FAULT_RPU_BAD_SURFACE_USAGE, surfaceId);
		return false;
	}
	m_surfaceDefined[surfaceId] = 1u;
	m_surfaceRevision[surfaceId] += 1u;
	m_surfaceWidth[surfaceId] = static_cast<u16>(width);
	m_surfaceHeight[surfaceId] = static_cast<u16>(height);
	m_surfaceFormat[surfaceId] = static_cast<u8>(format);
	m_surfaceUsage[surfaceId] = static_cast<u8>(usage);
	lastPacketCost = VDP_RPU_RESOURCE_COST;
	return true;
}

bool VdpRpuUnit::acceptConstantBankDefine(VdpRpuFrameOutput& frame, u32 bankId, u32 firstWord, u32 wordCount) {
	if (bankId >= VDP_RPU_CONSTANT_BANK_CAPACITY || wordCount > VDP_RPU_CONSTANT_WORD_CAPACITY || firstWord > VDP_RPU_CONSTANT_WORD_CAPACITY - wordCount) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	VdpRpuConstantBankTable& banks = frame.resources.constantBanks;
	banks.firstWord[bankId] = firstWord;
	banks.wordCount[bankId] = static_cast<u16>(wordCount);
	banks.epoch[bankId] += 1u;
	if (bankId + 1u > banks.length) {
		banks.length = bankId + 1u;
	}
	lastPacketCost = VDP_RPU_RESOURCE_COST;
	return true;
}

bool VdpRpuUnit::acceptConstantUploadDma(VdpRpuFrameOutput& frame, u32 bankId, u32 dstWordOffset, u32 srcAddr, u32 wordCount) {
	if (!acceptConstantRange(frame, bankId, dstWordOffset, wordCount) || !m_memory.isReadableMainMemoryRange(srcAddr, static_cast<size_t>(wordCount) * IO_WORD_SIZE)) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	const u32 firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
	for (u32 index = 0u; index < wordCount; ++index) {
		frame.resources.constantWords[firstWord + index] = m_memory.readU32(srcAddr + index * IO_WORD_SIZE);
	}
	frame.resources.constantBanks.epoch[bankId] += 1u;
	lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
	return true;
}

bool VdpRpuUnit::acceptConstantUploadInlineFromMemory(VdpRpuFrameOutput& frame, u32 cursor, u32 payloadWords) {
	if (payloadWords < VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	const u32 bankId = m_memory.readU32(cursor + IO_WORD_SIZE);
	const u32 dstWordOffset = m_memory.readU32(cursor + IO_WORD_SIZE * 2u);
	const u32 wordCount = m_memory.readU32(cursor + IO_WORD_SIZE * 3u);
	if (payloadWords != VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + wordCount || !acceptConstantRange(frame, bankId, dstWordOffset, wordCount)) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	const u32 firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
	for (u32 index = 0u; index < wordCount; ++index) {
		frame.resources.constantWords[firstWord + index] = m_memory.readU32(cursor + IO_WORD_SIZE * (VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + index));
	}
	frame.resources.constantBanks.epoch[bankId] += 1u;
	lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
	return true;
}

bool VdpRpuUnit::acceptConstantUploadInlineFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 cursor, u32 payloadWords) {
	if (payloadWords < VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS) {
		m_fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
		return false;
	}
	const u32 bankId = words[cursor + 1u];
	const u32 dstWordOffset = words[cursor + 2u];
	const u32 wordCount = words[cursor + 3u];
	if (payloadWords != VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + wordCount || !acceptConstantRange(frame, bankId, dstWordOffset, wordCount)) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	const u32 firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
	for (u32 index = 0u; index < wordCount; ++index) {
		frame.resources.constantWords[firstWord + index] = words[cursor + VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + index];
	}
	frame.resources.constantBanks.epoch[bankId] += 1u;
	lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
	return true;
}

bool VdpRpuUnit::acceptConstantUploadDevice(VdpRpuFrameOutput& frame, u32 bankId, u32 dstWordOffset, u32 sourceWord, u32 sourceWordOffset, u32 wordCount) {
	const u32 source = sourceWord & VDP_RPU_CONSTANT_SOURCE_MASK;
	const u32* sourceWords = m_xfMatrixWords.data();
	size_t sourceWordCount = m_xfMatrixWords.size();
	bool convertQ16 = true;
	switch (source) {
		case VDP_RPU_CONSTANT_SOURCE_XF_Q16:
			break;
		case VDP_RPU_CONSTANT_SOURCE_LPU_RAW:
			sourceWords = m_lightRegisterWords.data();
			sourceWordCount = m_lightRegisterWords.size();
			convertQ16 = false;
			break;
		case VDP_RPU_CONSTANT_SOURCE_MFU_Q16:
			sourceWords = m_morphWeightWords.data();
			sourceWordCount = m_morphWeightWords.size();
			break;
		case VDP_RPU_CONSTANT_SOURCE_JTU_Q16:
			sourceWords = m_jointMatrixWords.data();
			sourceWordCount = m_jointMatrixWords.size();
			break;
	}
	if (
		!acceptConstantRange(frame, bankId, dstWordOffset, wordCount)
		|| static_cast<size_t>(wordCount) > sourceWordCount
		|| static_cast<size_t>(sourceWordOffset) > sourceWordCount - static_cast<size_t>(wordCount)
	) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	const u32 firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
	for (u32 index = 0u; index < wordCount; ++index) {
		const u32 word = sourceWords[static_cast<size_t>(sourceWordOffset + index)];
		frame.resources.constantWords[firstWord + index] = convertQ16 ? encodeDeviceQ16WordAsF32Word(word) : word;
	}
	frame.resources.constantBanks.epoch[bankId] += 1u;
	lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
	return true;
}

u32 VdpRpuUnit::encodeDeviceQ16WordAsF32Word(u32 word) const {
	const f32 value = decodeSignedQ16_16(word);
	return std::bit_cast<u32>(value);
}

bool VdpRpuUnit::acceptConstantRange(const VdpRpuFrameOutput& frame, u32 bankId, u32 firstWord, u32 wordCount) const {
	return bankId < frame.resources.constantBanks.length
		&& wordCount <= frame.resources.constantBanks.wordCount[bankId]
		&& firstWord <= frame.resources.constantBanks.wordCount[bankId] - wordCount;
}

bool VdpRpuUnit::acceptBeginPass(VdpRpuFrameOutput& frame, u32 colorSurfaceId, u32 depthSurfaceId, u32 viewportXY, u32 viewportWH, u32 passOps, u32 clearColor, u32 clearDepthWord) {
	if (m_buildState != VDP_RPU_FRAME_OPEN || frame.commands.passCount >= VDP_RPU_PASS_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, passOps);
		return false;
	}
	const i32 colorRef = pinSurface(frame, colorSurfaceId);
	const i32 depthRef = pinSurface(frame, depthSurfaceId);
	const size_t passIndex = frame.commands.passCount;
	frame.commands.passFirstDraw[passIndex] = static_cast<u32>(frame.commands.drawCount);
	frame.commands.passDrawCount[passIndex] = 0u;
	frame.commands.passFirstBatch[passIndex] = static_cast<u32>(frame.commands.drawBatchCount);
	frame.commands.passBatchCount[passIndex] = 0u;
	frame.commands.passColorSurfaceRef[passIndex] = static_cast<u16>(colorRef);
	frame.commands.passDepthSurfaceRef[passIndex] = static_cast<u16>(depthRef);
	frame.commands.passViewportXY[passIndex] = viewportXY;
	frame.commands.passViewportWH[passIndex] = viewportWH;
	frame.commands.passOps[passIndex] = passOps;
	frame.commands.passClearColor[passIndex] = clearColor;
	frame.commands.passClearDepthWord[passIndex] = clearDepthWord;
	frame.commands.passCount += 1u;
	m_openPassIndex = static_cast<u32>(passIndex);
	m_buildState = VDP_RPU_PASS_OPEN;
	lastPacketCost = VDP_RPU_PASS_COST;
	return true;
}

bool VdpRpuUnit::acceptEndPass(VdpRpuFrameOutput& frame) {
	if (m_buildState != VDP_RPU_PASS_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	frame.commands.passDrawCount[m_openPassIndex] = static_cast<u16>(frame.commands.drawCount - frame.commands.passFirstDraw[m_openPassIndex]);
	frame.commands.passBatchCount[m_openPassIndex] = static_cast<u16>(frame.commands.drawBatchCount - frame.commands.passFirstBatch[m_openPassIndex]);
	m_buildState = VDP_RPU_FRAME_OPEN;
	lastPacketCost = VDP_RPU_PACKET_COST;
	return true;
}

bool VdpRpuUnit::acceptBeginDraw(VdpRpuFrameOutput& frame, u32 shaderVariantWord, u32 primitiveIndexType, u32 pipelineWord, u32 vertexCount, u32 instanceCount, u32 indexBufferId, u32 indexByteOffset, u32 indexCount) {
	if (m_buildState != VDP_RPU_PASS_OPEN || frame.commands.drawCount >= VDP_RPU_DRAW_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	const u32 shaderVariant = shaderVariantWord & VDP_RPU_SHADER_VARIANT_MASK;
	const u32 primitive = primitiveIndexType & VDP_RPU_DRAW_PRIMITIVE_MASK;
	const u32 indexType = (primitiveIndexType & VDP_RPU_DRAW_INDEX_TYPE_MASK) >> VDP_RPU_DRAW_INDEX_TYPE_SHIFT;
	i32 indexRef = static_cast<i32>(VDP_RPU_REF_NONE);
	if (indexType != VDP_RPU_INDEX_NONE) {
		const u32 indexBytes = indexType == VDP_RPU_INDEX_U16 ? 2u : 4u;
		const u32 indexByteLength = indexCount * indexBytes;
		indexRef = pinBuffer(frame, indexBufferId, indexByteOffset, indexByteLength, VDP_RPU_BUFFER_USAGE_INDEX);
	}
	const size_t drawIndex = frame.commands.drawCount;
	frame.commands.drawShaderVariant[drawIndex] = static_cast<u16>(shaderVariant);
	frame.commands.drawPrimitive[drawIndex] = static_cast<u8>(primitive);
	frame.commands.drawPipelineWord[drawIndex] = pipelineWord;
	frame.commands.drawVertexCount[drawIndex] = vertexCount;
	frame.commands.drawInstanceCount[drawIndex] = instanceCount;
	frame.commands.drawIndexBufferRef[drawIndex] = static_cast<u16>(indexRef);
	frame.commands.drawIndexByteOffset[drawIndex] = indexByteOffset;
	frame.commands.drawIndexCount[drawIndex] = indexCount;
	frame.commands.drawIndexType[drawIndex] = static_cast<u8>(indexType);
	frame.commands.drawFirstStreamBinding[drawIndex] = static_cast<u32>(frame.commands.streamBindingCount);
	frame.commands.drawStreamBindingCount[drawIndex] = 0u;
	frame.commands.drawFirstConstantBinding[drawIndex] = static_cast<u32>(frame.commands.constantBindingCount);
	frame.commands.drawConstantBindingCount[drawIndex] = 0u;
	frame.commands.drawFirstTextureBinding[drawIndex] = static_cast<u32>(frame.commands.textureBindingCount);
	frame.commands.drawTextureBindingCount[drawIndex] = 0u;
	frame.commands.drawCount += 1u;
	m_openDrawIndex = static_cast<u32>(drawIndex);
	m_buildState = VDP_RPU_DRAW_OPEN;
	lastPacketCost = rpuDrawCost(vertexCount, instanceCount, indexCount);
	return true;
}

bool VdpRpuUnit::acceptEndDraw(VdpRpuFrameOutput& frame) {
	if (m_buildState != VDP_RPU_DRAW_OPEN) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STATE, m_buildState);
		return false;
	}
	const size_t drawIndex = m_openDrawIndex;
	frame.commands.drawStreamBindingCount[drawIndex] = static_cast<u8>(frame.commands.streamBindingCount - frame.commands.drawFirstStreamBinding[drawIndex]);
	frame.commands.drawConstantBindingCount[drawIndex] = static_cast<u8>(frame.commands.constantBindingCount - frame.commands.drawFirstConstantBinding[drawIndex]);
	frame.commands.drawTextureBindingCount[drawIndex] = static_cast<u8>(frame.commands.textureBindingCount - frame.commands.drawFirstTextureBinding[drawIndex]);
	if (!recordDrawBatch(frame, static_cast<u32>(drawIndex))) {
		return false;
	}
	m_buildState = VDP_RPU_PASS_OPEN;
	lastPacketCost = VDP_RPU_PACKET_COST;
	return true;
}

bool VdpRpuUnit::recordDrawBatch(VdpRpuFrameOutput& frame, u32 drawIndex) {
	VdpRpuCommandBuffer& commands = frame.commands;
	if (commands.drawBatchCount > commands.passFirstBatch[m_openPassIndex]) {
		const size_t batchIndex = commands.drawBatchCount - 1u;
		if (canMergeDrawIntoBatch(commands, batchIndex, drawIndex)) {
			commands.batchDrawCount[batchIndex] = static_cast<u16>(commands.batchDrawCount[batchIndex] + 1u);
			if (commands.drawIndexType[drawIndex] == VDP_RPU_INDEX_NONE) {
				const VdpRpuShaderVariantSpec& shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[drawIndex]);
				if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE) {
					commands.batchVertexCount[batchIndex] += commands.drawVertexCount[drawIndex];
				} else {
					commands.batchInstanceCount[batchIndex] += commands.drawInstanceCount[drawIndex];
				}
			} else {
				const VdpRpuShaderVariantSpec& shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[drawIndex]);
				if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE) {
					commands.batchIndexCount[batchIndex] += commands.drawIndexCount[drawIndex];
				} else {
					commands.batchInstanceCount[batchIndex] += commands.drawInstanceCount[drawIndex];
				}
			}
			return true;
		}
	}
	if (commands.drawBatchCount >= VDP_RPU_DRAW_BATCH_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, drawIndex);
		return false;
	}
	const size_t batchIndex = commands.drawBatchCount;
	commands.batchFirstDraw[batchIndex] = drawIndex;
	commands.batchDrawCount[batchIndex] = 1u;
	commands.batchVertexCount[batchIndex] = commands.drawVertexCount[drawIndex];
	commands.batchInstanceCount[batchIndex] = commands.drawInstanceCount[drawIndex];
	commands.batchIndexCount[batchIndex] = commands.drawIndexCount[drawIndex];
	commands.drawBatchCount += 1u;
	return true;
}

bool VdpRpuUnit::canMergeDrawIntoBatch(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex) const {
	const u32 firstDraw = commands.batchFirstDraw[batchIndex];
	if (commands.drawPrimitive[firstDraw] == VDP_RPU_PRIM_TRIANGLE_STRIP) {
		return false;
	}
	if (
		commands.drawShaderVariant[firstDraw] != commands.drawShaderVariant[drawIndex]
		|| commands.drawPrimitive[firstDraw] != commands.drawPrimitive[drawIndex]
		|| commands.drawPipelineWord[firstDraw] != commands.drawPipelineWord[drawIndex]
		|| commands.drawIndexType[firstDraw] != commands.drawIndexType[drawIndex]
		|| commands.drawIndexBufferRef[firstDraw] != commands.drawIndexBufferRef[drawIndex]
		|| !sameDrawConstants(commands, firstDraw, drawIndex)
		|| !sameDrawTextures(commands, firstDraw, drawIndex)
		|| !compatibleDrawStreams(commands, batchIndex, drawIndex)
	) {
		return false;
	}
	const VdpRpuShaderVariantSpec& shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[firstDraw]);
	if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE) {
		const u32 batchElementCount = commands.drawIndexType[firstDraw] == VDP_RPU_INDEX_NONE ? commands.batchVertexCount[batchIndex] : commands.batchIndexCount[batchIndex];
		const u32 drawElementCount = commands.drawIndexType[firstDraw] == VDP_RPU_INDEX_NONE ? commands.drawVertexCount[drawIndex] : commands.drawIndexCount[drawIndex];
		if (commands.drawPrimitive[firstDraw] == VDP_RPU_PRIM_LINES) {
			if (((batchElementCount | drawElementCount) & 1u) != 0u) {
				return false;
			}
		} else if (commands.drawPrimitive[firstDraw] == VDP_RPU_PRIM_TRIANGLES && (batchElementCount % 3u != 0u || drawElementCount % 3u != 0u)) {
			return false;
		}
	}
	if (commands.drawIndexType[firstDraw] == VDP_RPU_INDEX_NONE) {
		if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE) {
			return streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 0u, commands.batchVertexCount[batchIndex]);
		}
		return commands.drawVertexCount[firstDraw] == commands.drawVertexCount[drawIndex]
			&& streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0u)
			&& streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 1u, commands.batchInstanceCount[batchIndex]);
	}
	if (shaderVariant.instanceMode == VDP_RPU_INSTANCE_MODE_NONE) {
		const u32 indexBytes = commands.drawIndexType[firstDraw] == VDP_RPU_INDEX_U16 ? 2u : 4u;
		return commands.drawIndexByteOffset[drawIndex] == commands.drawIndexByteOffset[firstDraw] + commands.batchIndexCount[batchIndex] * indexBytes
			&& streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0u);
	}
	return commands.drawIndexByteOffset[drawIndex] == commands.drawIndexByteOffset[firstDraw]
		&& commands.drawIndexCount[drawIndex] == commands.drawIndexCount[firstDraw]
		&& commands.drawVertexCount[drawIndex] == commands.drawVertexCount[firstDraw]
		&& streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0u)
		&& streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 1u, commands.batchInstanceCount[batchIndex]);
}

bool VdpRpuUnit::sameDrawConstants(const VdpRpuCommandBuffer& commands, u32 leftDraw, u32 rightDraw) const {
	const u32 leftCount = commands.drawConstantBindingCount[leftDraw];
	if (leftCount != commands.drawConstantBindingCount[rightDraw]) {
		return false;
	}
	const u32 leftFirst = commands.drawFirstConstantBinding[leftDraw];
	const u32 rightFirst = commands.drawFirstConstantBinding[rightDraw];
	for (u32 offset = 0u; offset < leftCount; ++offset) {
		const u32 left = leftFirst + offset;
		const u32 right = rightFirst + offset;
		if (
			commands.constantBindingSlot[left] != commands.constantBindingSlot[right]
			|| commands.constantBank[left] != commands.constantBank[right]
			|| commands.constantFirstWord[left] != commands.constantFirstWord[right]
			|| commands.constantWordCount[left] != commands.constantWordCount[right]
		) {
			return false;
		}
	}
	return true;
}

bool VdpRpuUnit::sameDrawTextures(const VdpRpuCommandBuffer& commands, u32 leftDraw, u32 rightDraw) const {
	const u32 leftCount = commands.drawTextureBindingCount[leftDraw];
	if (leftCount != commands.drawTextureBindingCount[rightDraw]) {
		return false;
	}
	const u32 leftFirst = commands.drawFirstTextureBinding[leftDraw];
	const u32 rightFirst = commands.drawFirstTextureBinding[rightDraw];
	for (u32 offset = 0u; offset < leftCount; ++offset) {
		const u32 left = leftFirst + offset;
		const u32 right = rightFirst + offset;
		if (
			commands.textureSlot[left] != commands.textureSlot[right]
			|| commands.textureSurfaceRef[left] != commands.textureSurfaceRef[right]
			|| commands.textureSamplerWord[left] != commands.textureSamplerWord[right]
		) {
			return false;
		}
	}
	return true;
}

bool VdpRpuUnit::compatibleDrawStreams(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex) const {
	const u32 firstDraw = commands.batchFirstDraw[batchIndex];
	const u32 firstCount = commands.drawStreamBindingCount[firstDraw];
	if (firstCount != commands.drawStreamBindingCount[drawIndex]) {
		return false;
	}
	const u32 firstBinding = commands.drawFirstStreamBinding[firstDraw];
	const u32 drawBinding = commands.drawFirstStreamBinding[drawIndex];
	for (u32 offset = 0u; offset < firstCount; ++offset) {
		const u32 left = firstBinding + offset;
		const u32 right = drawBinding + offset;
		if (
			commands.streamSlot[left] != commands.streamSlot[right]
			|| commands.streamLayoutId[left] != commands.streamLayoutId[right]
			|| commands.streamBufferRef[left] != commands.streamBufferRef[right]
			|| commands.streamStepRate[left] != commands.streamStepRate[right]
		) {
			return false;
		}
	}
	return true;
}

u32 VdpRpuUnit::drawStreamBinding(const VdpRpuCommandBuffer& commands, u32 drawIndex, u32 streamSlot) const {
	const u32 bindingEnd = commands.drawFirstStreamBinding[drawIndex] + commands.drawStreamBindingCount[drawIndex];
	for (u32 bindingIndex = commands.drawFirstStreamBinding[drawIndex]; bindingIndex < bindingEnd; ++bindingIndex) {
		if (commands.streamSlot[bindingIndex] == streamSlot) {
			return bindingIndex;
		}
	}
	return VDP_RPU_REF_NONE;
}

bool VdpRpuUnit::streamOffsetMatchesBatchHead(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex, u32 streamSlot) const {
	const u32 firstBinding = drawStreamBinding(commands, commands.batchFirstDraw[batchIndex], streamSlot);
	const u32 currentBinding = drawStreamBinding(commands, drawIndex, streamSlot);
	if (firstBinding == VDP_RPU_REF_NONE || currentBinding == VDP_RPU_REF_NONE) {
		return firstBinding == currentBinding;
	}
	return commands.streamByteOffset[firstBinding] == commands.streamByteOffset[currentBinding];
}

bool VdpRpuUnit::streamOffsetIsBatchTail(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex, u32 streamSlot, u32 elementCount) const {
	const u32 firstBinding = drawStreamBinding(commands, commands.batchFirstDraw[batchIndex], streamSlot);
	const u32 currentBinding = drawStreamBinding(commands, drawIndex, streamSlot);
	if (firstBinding == VDP_RPU_REF_NONE || currentBinding == VDP_RPU_REF_NONE) {
		return false;
	}
	const u32 stride = streamLayoutStride(commands.streamLayoutId[firstBinding]);
	return commands.streamByteOffset[currentBinding] == commands.streamByteOffset[firstBinding] + elementCount * stride;
}

bool VdpRpuUnit::acceptBindStream(VdpRpuFrameOutput& frame, u32 streamSlot, u32 layoutId, u32 bufferId, u32 byteOffset, u32 stepRate) {
	if (m_buildState != VDP_RPU_DRAW_OPEN || frame.commands.streamBindingCount >= VDP_RPU_STREAM_BINDING_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_STREAM_LAYOUT, layoutId);
		return false;
	}
	const size_t drawIndex = m_openDrawIndex;
	const u32 elementCount = stepRate == 0u ? frame.commands.drawVertexCount[drawIndex] : frame.commands.drawInstanceCount[drawIndex];
	const u32 byteStride = streamLayoutStride(layoutId);
	const u32 byteLength = elementCount * byteStride;
	const i32 bufferRef = pinBuffer(frame, bufferId, byteOffset, byteLength, VDP_RPU_BUFFER_USAGE_VERTEX);
	const size_t bindingIndex = frame.commands.streamBindingCount;
	frame.commands.streamLayoutId[bindingIndex] = static_cast<u16>(layoutId);
	frame.commands.streamSlot[bindingIndex] = static_cast<u8>(streamSlot);
	frame.commands.streamBufferRef[bindingIndex] = static_cast<u16>(bufferRef);
	frame.commands.streamByteOffset[bindingIndex] = byteOffset;
	frame.commands.streamStepRate[bindingIndex] = static_cast<u8>(stepRate);
	frame.commands.streamBindingCount += 1u;
	lastPacketCost = VDP_RPU_BIND_COST;
	return true;
}

bool VdpRpuUnit::acceptBindConstants(VdpRpuFrameOutput& frame, u32 bindingSlot, u32 bankId, u32 firstWord, u32 wordCount) {
	if (m_buildState != VDP_RPU_DRAW_OPEN || frame.commands.constantBindingCount >= VDP_RPU_CONSTANT_BINDING_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
		return false;
	}
	u32 boundBankId = bankId;
	u32 boundFirstWord = firstWord;
	u32 boundWordCount = wordCount;
	if (!acceptConstantRange(frame, bankId, firstWord, wordCount)) {
		boundBankId = VDP_RPU_REF_NONE;
		boundFirstWord = 0u;
		boundWordCount = 0u;
	}
	const size_t bindingIndex = frame.commands.constantBindingCount;
	frame.commands.constantBindingSlot[bindingIndex] = static_cast<u8>(bindingSlot);
	frame.commands.constantBank[bindingIndex] = static_cast<u16>(boundBankId);
	frame.commands.constantFirstWord[bindingIndex] = static_cast<u16>(boundFirstWord);
	frame.commands.constantWordCount[bindingIndex] = static_cast<u16>(boundWordCount);
	frame.commands.constantBindingCount += 1u;
	lastPacketCost = VDP_RPU_BIND_COST;
	return true;
}

bool VdpRpuUnit::acceptBindTexture(VdpRpuFrameOutput& frame, u32 textureSlot, u32 surfaceId, u32 samplerWord) {
	if (m_buildState != VDP_RPU_DRAW_OPEN || frame.commands.textureBindingCount >= VDP_RPU_TEXTURE_BINDING_CAPACITY) {
		m_fault.raise(VDP_FAULT_RPU_BAD_SURFACE_USAGE, surfaceId);
		return false;
	}
	const i32 surfaceRef = pinSurface(frame, surfaceId);
	const size_t bindingIndex = frame.commands.textureBindingCount;
	frame.commands.textureSlot[bindingIndex] = static_cast<u8>(textureSlot);
	frame.commands.textureSurfaceRef[bindingIndex] = static_cast<u16>(surfaceRef);
	frame.commands.textureSamplerWord[bindingIndex] = samplerWord;
	frame.commands.textureBindingCount += 1u;
	lastPacketCost = VDP_RPU_BIND_COST;
	return true;
}

i32 VdpRpuUnit::pinBuffer(VdpRpuFrameOutput& frame, u32 bufferId, u32 byteOffset, u32 byteLength, u32 usage) {
	if (!acceptBufferRange(bufferId, byteOffset, byteLength) || byteLength > VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY) {
		return static_cast<i32>(VDP_RPU_REF_NONE);
	}
	VdpRpuFrameBufferRefs& refs = frame.resources.bufferRefs;
	const u32 revision = m_bufferRevision[bufferId];
	const u32 bufferOffset = bufferByteBase(bufferId);
	const u32 requestEnd = byteOffset + byteLength;
	const u32 snapshotByteLimit = static_cast<u32>(VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY) - byteLength;
	for (size_t refIndex = 0u; refIndex < refs.length; ++refIndex) {
		if (refs.bufferId[refIndex] == bufferId && refs.revision[refIndex] == revision && refs.usage[refIndex] == usage) {
			const u32 sourceByteOffset = refs.sourceByteOffset[refIndex];
			const u32 sourceByteEnd = sourceByteOffset + refs.byteLength[refIndex];
			if (byteOffset >= sourceByteOffset && requestEnd <= sourceByteEnd) {
				return static_cast<i32>(refIndex);
			}
			if (byteOffset == sourceByteEnd) {
				if (refs.snapshotByteLength > snapshotByteLimit) {
					return static_cast<i32>(VDP_RPU_REF_NONE);
				}
				const size_t snapshotOffset = refs.byteOffset[refIndex] + refs.byteLength[refIndex];
				for (size_t index = 0u; index < byteLength; ++index) {
					refs.snapshotBytes[snapshotOffset + index] = m_bufferBytes[bufferOffset + byteOffset + index];
				}
				refs.byteLength[refIndex] += byteLength;
				refs.snapshotByteLength += byteLength;
				return static_cast<i32>(refIndex);
			}
		}
	}
	if (refs.length >= VDP_RPU_BUFFER_REF_CAPACITY) {
		return static_cast<i32>(VDP_RPU_REF_NONE);
	}
	if (refs.snapshotByteLength > snapshotByteLimit) {
		return static_cast<i32>(VDP_RPU_REF_NONE);
	}
	const size_t snapshotOffset = refs.snapshotByteLength;
	for (size_t index = 0u; index < byteLength; ++index) {
		refs.snapshotBytes[snapshotOffset + index] = m_bufferBytes[bufferOffset + byteOffset + index];
	}
	const size_t refIndex = refs.length;
	refs.bufferId[refIndex] = bufferId;
	refs.revision[refIndex] = revision;
	refs.sourceByteOffset[refIndex] = byteOffset;
	refs.byteOffset[refIndex] = static_cast<u32>(snapshotOffset);
	refs.byteLength[refIndex] = byteLength;
	refs.usage[refIndex] = static_cast<u8>(usage);
	refs.bytes[refIndex] = refs.snapshotBytes.data();
	refs.length += 1u;
	refs.snapshotByteLength += byteLength;
	return static_cast<i32>(refIndex);
}

i32 VdpRpuUnit::pinSurface(VdpRpuFrameOutput& frame, u32 surfaceId) {
	if (surfaceId == VDP_RPU_RESOURCE_NONE) {
		return static_cast<i32>(VDP_RPU_REF_NONE);
	}
	if (frame.resources.surfaceRefs.length >= VDP_RPU_SURFACE_REF_CAPACITY || surfaceId >= VDP_RPU_SURFACE_CAPACITY || m_surfaceDefined[surfaceId] == 0u) {
		return static_cast<i32>(VDP_RPU_REF_NONE);
	}
	const size_t refIndex = frame.resources.surfaceRefs.length;
	frame.resources.surfaceRefs.surfaceId[refIndex] = surfaceId;
	frame.resources.surfaceRefs.revision[refIndex] = m_surfaceRevision[surfaceId];
	frame.resources.surfaceRefs.width[refIndex] = m_surfaceWidth[surfaceId];
	frame.resources.surfaceRefs.height[refIndex] = m_surfaceHeight[surfaceId];
	frame.resources.surfaceRefs.format[refIndex] = m_surfaceFormat[surfaceId];
	frame.resources.surfaceRefs.usage[refIndex] = m_surfaceUsage[surfaceId];
	frame.resources.surfaceRefs.length += 1u;
	return static_cast<i32>(refIndex);
}

bool VdpRpuUnit::acceptBufferRange(u32 bufferId, u32 byteOffset, u32 byteLength) const {
	return bufferId < VDP_RPU_BUFFER_CAPACITY
		&& m_bufferDefined[bufferId] != 0u
		&& byteLength <= m_bufferByteLength[bufferId]
		&& byteOffset <= m_bufferByteLength[bufferId] - byteLength;
}

u32 VdpRpuUnit::bufferByteBase(u32 bufferId) const {
	return bufferId * static_cast<u32>(VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY);
}

u32 VdpRpuUnit::streamLayoutStride(u32 layoutId) const {
	return resolveVdpRpuStreamLayoutSpec(layoutId).byteStride;
}

std::unique_ptr<VdpRpuFrameOutput> createVdpRpuFrameOutput() {
	return std::make_unique<VdpRpuFrameOutput>();
}

void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame) {
	frame.commands.passCount = 0u;
	frame.commands.drawCount = 0u;
	frame.commands.drawBatchCount = 0u;
	frame.commands.streamBindingCount = 0u;
	frame.commands.constantBindingCount = 0u;
	frame.commands.textureBindingCount = 0u;
	frame.resources.bufferRefs.length = 0u;
	frame.resources.bufferRefs.snapshotByteLength = 0u;
	frame.resources.surfaceRefs.length = 0u;
	frame.resources.constantBanks.length = 0u;
}

VdpRpuFrameSaveState captureVdpRpuFrameState(const VdpRpuFrameOutput& frame) {
	VdpRpuFrameSaveState state;
	state.commands = captureVdpRpuCommandBufferState(frame.commands);
	state.bufferRefs = captureVdpRpuFrameBufferRefsState(frame.resources.bufferRefs);
	state.bufferBytes.assign(frame.resources.bufferRefs.snapshotBytes.begin(), frame.resources.bufferRefs.snapshotBytes.begin() + static_cast<std::ptrdiff_t>(frame.resources.bufferRefs.snapshotByteLength));
	state.surfaceRefs = captureVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs);
	state.constantWords = captureVdpRpuConstantWords(frame);
	state.constantBanks = captureVdpRpuConstantBankState(frame.resources.constantBanks);
	return state;
}

void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state) {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
	restoreVdpRpuFrameBufferRefsState(frame.resources.bufferRefs, state.bufferRefs);
	for (size_t index = 0u; index < state.bufferBytes.size(); ++index) {
		frame.resources.bufferRefs.snapshotBytes[index] = state.bufferBytes[index];
	}
	frame.resources.bufferRefs.snapshotByteLength = state.bufferBytes.size();
	for (size_t index = 0u; index < frame.resources.bufferRefs.length; ++index) {
		frame.resources.bufferRefs.bytes[index] = frame.resources.bufferRefs.snapshotBytes.data();
	}
	restoreVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs, state.surfaceRefs);
	restoreVdpRpuArrayState(frame.resources.constantWords, state.constantWords);
	restoreVdpRpuConstantBankState(frame.resources.constantBanks, state.constantBanks);
}

} // namespace bmsx
