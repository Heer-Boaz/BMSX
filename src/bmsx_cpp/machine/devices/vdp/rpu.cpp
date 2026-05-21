#include "machine/devices/vdp/rpu.h"

namespace bmsx {
namespace {

template<typename T, size_t N>
std::vector<T> capturePrefix(const std::array<T, N>& values, size_t count) {
	return std::vector<T>(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(count));
}

template<typename T, size_t N>
void restorePrefix(std::array<T, N>& target, const std::vector<T>& values) {
	for (size_t index = 0u; index < values.size(); ++index) {
		target[index] = values[index];
	}
}

VdpRpuCommandBufferSaveState captureVdpRpuCommandBufferState(const VdpRpuCommandBuffer& commands) {
	VdpRpuCommandBufferSaveState state;
	state.passCount = commands.passCount;
	state.drawCount = commands.drawCount;
	state.streamBindingCount = commands.streamBindingCount;
	state.constantBindingCount = commands.constantBindingCount;
	state.textureBindingCount = commands.textureBindingCount;
	state.passFirstDraw = capturePrefix(commands.passFirstDraw, commands.passCount);
	state.passDrawCount = capturePrefix(commands.passDrawCount, commands.passCount);
	state.passColorSurfaceRef = capturePrefix(commands.passColorSurfaceRef, commands.passCount);
	state.passDepthSurfaceRef = capturePrefix(commands.passDepthSurfaceRef, commands.passCount);
	state.passViewportXY = capturePrefix(commands.passViewportXY, commands.passCount);
	state.passViewportWH = capturePrefix(commands.passViewportWH, commands.passCount);
	state.passOps = capturePrefix(commands.passOps, commands.passCount);
	state.passClearColor = capturePrefix(commands.passClearColor, commands.passCount);
	state.passClearDepthWord = capturePrefix(commands.passClearDepthWord, commands.passCount);
	state.drawShaderVariant = capturePrefix(commands.drawShaderVariant, commands.drawCount);
	state.drawPrimitive = capturePrefix(commands.drawPrimitive, commands.drawCount);
	state.drawPipelineWord = capturePrefix(commands.drawPipelineWord, commands.drawCount);
	state.drawVertexCount = capturePrefix(commands.drawVertexCount, commands.drawCount);
	state.drawInstanceCount = capturePrefix(commands.drawInstanceCount, commands.drawCount);
	state.drawIndexBufferRef = capturePrefix(commands.drawIndexBufferRef, commands.drawCount);
	state.drawIndexByteOffset = capturePrefix(commands.drawIndexByteOffset, commands.drawCount);
	state.drawIndexCount = capturePrefix(commands.drawIndexCount, commands.drawCount);
	state.drawIndexType = capturePrefix(commands.drawIndexType, commands.drawCount);
	state.drawFirstStreamBinding = capturePrefix(commands.drawFirstStreamBinding, commands.drawCount);
	state.drawStreamBindingCount = capturePrefix(commands.drawStreamBindingCount, commands.drawCount);
	state.drawFirstConstantBinding = capturePrefix(commands.drawFirstConstantBinding, commands.drawCount);
	state.drawConstantBindingCount = capturePrefix(commands.drawConstantBindingCount, commands.drawCount);
	state.drawFirstTextureBinding = capturePrefix(commands.drawFirstTextureBinding, commands.drawCount);
	state.drawTextureBindingCount = capturePrefix(commands.drawTextureBindingCount, commands.drawCount);
	state.streamLayoutId = capturePrefix(commands.streamLayoutId, commands.streamBindingCount);
	state.streamBufferRef = capturePrefix(commands.streamBufferRef, commands.streamBindingCount);
	state.streamByteOffset = capturePrefix(commands.streamByteOffset, commands.streamBindingCount);
	state.streamStepRate = capturePrefix(commands.streamStepRate, commands.streamBindingCount);
	state.constantBindingSlot = capturePrefix(commands.constantBindingSlot, commands.constantBindingCount);
	state.constantBank = capturePrefix(commands.constantBank, commands.constantBindingCount);
	state.constantFirstWord = capturePrefix(commands.constantFirstWord, commands.constantBindingCount);
	state.constantWordCount = capturePrefix(commands.constantWordCount, commands.constantBindingCount);
	state.textureSlot = capturePrefix(commands.textureSlot, commands.textureBindingCount);
	state.textureSurfaceRef = capturePrefix(commands.textureSurfaceRef, commands.textureBindingCount);
	state.textureSamplerWord = capturePrefix(commands.textureSamplerWord, commands.textureBindingCount);
	return state;
}

void restoreVdpRpuCommandBufferState(VdpRpuCommandBuffer& commands, const VdpRpuCommandBufferSaveState& state) {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	restorePrefix(commands.passFirstDraw, state.passFirstDraw);
	restorePrefix(commands.passDrawCount, state.passDrawCount);
	restorePrefix(commands.passColorSurfaceRef, state.passColorSurfaceRef);
	restorePrefix(commands.passDepthSurfaceRef, state.passDepthSurfaceRef);
	restorePrefix(commands.passViewportXY, state.passViewportXY);
	restorePrefix(commands.passViewportWH, state.passViewportWH);
	restorePrefix(commands.passOps, state.passOps);
	restorePrefix(commands.passClearColor, state.passClearColor);
	restorePrefix(commands.passClearDepthWord, state.passClearDepthWord);
	restorePrefix(commands.drawShaderVariant, state.drawShaderVariant);
	restorePrefix(commands.drawPrimitive, state.drawPrimitive);
	restorePrefix(commands.drawPipelineWord, state.drawPipelineWord);
	restorePrefix(commands.drawVertexCount, state.drawVertexCount);
	restorePrefix(commands.drawInstanceCount, state.drawInstanceCount);
	restorePrefix(commands.drawIndexBufferRef, state.drawIndexBufferRef);
	restorePrefix(commands.drawIndexByteOffset, state.drawIndexByteOffset);
	restorePrefix(commands.drawIndexCount, state.drawIndexCount);
	restorePrefix(commands.drawIndexType, state.drawIndexType);
	restorePrefix(commands.drawFirstStreamBinding, state.drawFirstStreamBinding);
	restorePrefix(commands.drawStreamBindingCount, state.drawStreamBindingCount);
	restorePrefix(commands.drawFirstConstantBinding, state.drawFirstConstantBinding);
	restorePrefix(commands.drawConstantBindingCount, state.drawConstantBindingCount);
	restorePrefix(commands.drawFirstTextureBinding, state.drawFirstTextureBinding);
	restorePrefix(commands.drawTextureBindingCount, state.drawTextureBindingCount);
	restorePrefix(commands.streamLayoutId, state.streamLayoutId);
	restorePrefix(commands.streamBufferRef, state.streamBufferRef);
	restorePrefix(commands.streamByteOffset, state.streamByteOffset);
	restorePrefix(commands.streamStepRate, state.streamStepRate);
	restorePrefix(commands.constantBindingSlot, state.constantBindingSlot);
	restorePrefix(commands.constantBank, state.constantBank);
	restorePrefix(commands.constantFirstWord, state.constantFirstWord);
	restorePrefix(commands.constantWordCount, state.constantWordCount);
	restorePrefix(commands.textureSlot, state.textureSlot);
	restorePrefix(commands.textureSurfaceRef, state.textureSurfaceRef);
	restorePrefix(commands.textureSamplerWord, state.textureSamplerWord);
}

std::vector<VdpRpuFrameBufferRefSaveState> captureVdpRpuFrameBufferRefsState(const VdpRpuFrameBufferRefs& refs) {
	std::vector<VdpRpuFrameBufferRefSaveState> states;
	states.reserve(refs.length);
	for (size_t index = 0u; index < refs.length; ++index) {
		states.push_back(VdpRpuFrameBufferRefSaveState{
			refs.bufferId[index],
			refs.revision[index],
			refs.byteOffset[index],
			refs.byteLength[index],
			refs.usage[index],
		});
	}
	return states;
}

void restoreVdpRpuFrameBufferRefsState(VdpRpuFrameBufferRefs& refs, const std::vector<VdpRpuFrameBufferRefSaveState>& states) {
	refs.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		const VdpRpuFrameBufferRefSaveState& state = states[index];
		refs.bufferId[index] = state.bufferId;
		refs.revision[index] = state.revision;
		refs.byteOffset[index] = state.byteOffset;
		refs.byteLength[index] = state.byteLength;
		refs.usage[index] = static_cast<u8>(state.usage);
	}
}

std::vector<VdpRpuFrameSurfaceRefSaveState> captureVdpRpuFrameSurfaceRefsState(const VdpRpuFrameSurfaceRefs& refs) {
	std::vector<VdpRpuFrameSurfaceRefSaveState> states;
	states.reserve(refs.length);
	for (size_t index = 0u; index < refs.length; ++index) {
		states.push_back(VdpRpuFrameSurfaceRefSaveState{
			refs.surfaceId[index],
			refs.revision[index],
			refs.width[index],
			refs.height[index],
			refs.format[index],
			refs.usage[index],
		});
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
	states.reserve(banks.length);
	for (size_t index = 0u; index < banks.length; ++index) {
		states.push_back(VdpRpuConstantBankSaveState{
			banks.firstWord[index],
			banks.wordCount[index],
			banks.epoch[index],
		});
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
	return capturePrefix(frame.resources.constantWords, wordCount);
}

} // namespace

std::unique_ptr<VdpRpuFrameOutput> createVdpRpuFrameOutput() {
	return std::make_unique<VdpRpuFrameOutput>();
}

void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame) {
	frame.commands.passCount = 0u;
	frame.commands.drawCount = 0u;
	frame.commands.streamBindingCount = 0u;
	frame.commands.constantBindingCount = 0u;
	frame.commands.textureBindingCount = 0u;
	frame.resources.bufferRevisions.clear();
	frame.resources.surfaceRevisions.clear();
	frame.resources.bufferRefs.length = 0u;
	frame.resources.surfaceRefs.length = 0u;
	frame.resources.constantBanks.length = 0u;
}

VdpRpuFrameSaveState captureVdpRpuFrameState(const VdpRpuFrameOutput& frame) {
	VdpRpuFrameSaveState state;
	state.commands = captureVdpRpuCommandBufferState(frame.commands);
	state.bufferRefs = captureVdpRpuFrameBufferRefsState(frame.resources.bufferRefs);
	state.surfaceRefs = captureVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs);
	for (const VdpRpuBufferRevision& revision : frame.resources.bufferRevisions) {
		state.bufferRevisions.push_back(VdpRpuBufferRevisionSaveState{revision.bufferId, revision.revision, revision.bytes});
	}
	for (const VdpRpuSurfaceRevision& revision : frame.resources.surfaceRevisions) {
		state.surfaceRevisions.push_back(VdpRpuSurfaceRevisionSaveState{revision.surfaceId, revision.revision, revision.bytes});
	}
	state.constantWords = captureVdpRpuConstantWords(frame);
	state.constantBanks = captureVdpRpuConstantBankState(frame.resources.constantBanks);
	return state;
}

void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state) {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
	restoreVdpRpuFrameBufferRefsState(frame.resources.bufferRefs, state.bufferRefs);
	restoreVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs, state.surfaceRefs);
	for (const VdpRpuBufferRevisionSaveState& revision : state.bufferRevisions) {
		frame.resources.bufferRevisions.push_back(VdpRpuBufferRevision{revision.bufferId, revision.revision, revision.bytes});
	}
	for (const VdpRpuSurfaceRevisionSaveState& revision : state.surfaceRevisions) {
		frame.resources.surfaceRevisions.push_back(VdpRpuSurfaceRevision{revision.surfaceId, revision.revision, revision.bytes});
	}
	restorePrefix(frame.resources.constantWords, state.constantWords);
	restoreVdpRpuConstantBankState(frame.resources.constantBanks, state.constantBanks);
}

} // namespace bmsx
