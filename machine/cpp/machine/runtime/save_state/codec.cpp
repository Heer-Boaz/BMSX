#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binary_stream.h"
#include "spec/audio/apu.h"

namespace bmsx {
namespace {

// One current internal layout, deliberately without a legacy reader.
constexpr u32 kSaveStateSignature = 0x53534d42u; // BMSS

template<class Writer> void writeFrameSchedulerStateSnapshot(Writer& writer, const FrameSchedulerStateSnapshot& state) {
	writer.f64(state.accumulatedHostTimeMs);
	writer.f64(state.cycleGrantRemainder);
	writer.i64(state.carriedCycleBudget);
	writer.boolean(state.tickCompletionPending);
	writer.boolean(state.tickCompletionVisualCommitted);
	writer.boolean(state.logicalTickRunPending);
	writer.i64(state.logicalTickRunTargetSequence);
	writer.i64(state.lastTickSequence);
	writer.i64(state.lastTickBudgetGranted);
	writer.i64(state.lastTickCpuBudgetGranted);
	writer.i64(state.lastTickCpuUsedCycles);
	writer.i64(state.lastTickBudgetRemaining);
	writer.boolean(state.lastTickVisualFrameCommitted);
	writer.boolean(state.lastTickCompleted);
	writer.i64(state.lastTickConsumedSequence);
}

FrameSchedulerStateSnapshot readFrameSchedulerStateSnapshot(BinaryReader& reader) {
	FrameSchedulerStateSnapshot state;
	state.accumulatedHostTimeMs = reader.f64();
	state.cycleGrantRemainder = reader.f64();
	state.carriedCycleBudget = reader.i64();
	state.tickCompletionPending = reader.boolean();
	state.tickCompletionVisualCommitted = reader.boolean();
	state.logicalTickRunPending = reader.boolean();
	state.logicalTickRunTargetSequence = reader.i64();
	state.lastTickSequence = reader.i64();
	state.lastTickBudgetGranted = reader.i64();
	state.lastTickCpuBudgetGranted = reader.i64();
	state.lastTickCpuUsedCycles = reader.i64();
	state.lastTickBudgetRemaining = reader.i64();
	state.lastTickVisualFrameCommitted = reader.boolean();
	state.lastTickCompleted = reader.boolean();
	state.lastTickConsumedSequence = reader.i64();
	return state;
}

template<class Writer> void writeFrameState(Writer& writer, const FrameState& state) {
	writer.boolean(state.updateExecuted);
	writer.i64(state.cycleBudgetRemaining);
	writer.i64(state.cycleBudgetGranted);
	writer.i64(state.cycleCarryGranted);
	writer.i64(state.activeCpuUsedCycles);
}

FrameState readFrameState(BinaryReader& reader) {
	FrameState state;
	state.updateExecuted = reader.boolean();
	state.cycleBudgetRemaining = reader.i64();
	state.cycleBudgetGranted = reader.i64();
	state.cycleCarryGranted = reader.i64();
	state.activeCpuUsedCycles = reader.i64();
	return state;
}

template<class Writer> void writeFrameLoopStateSnapshot(Writer& writer, const FrameLoopStateSnapshot& state) {
	writeFrameState(writer, state.frameState);
	writer.boolean(state.frameActive);
}

FrameLoopStateSnapshot readFrameLoopStateSnapshot(BinaryReader& reader) {
	FrameLoopStateSnapshot state;
	state.frameState = readFrameState(reader);
	state.frameActive = reader.boolean();
	return state;
}

template<class Writer> void writeCartridgeMailboxState(Writer& writer, const CartridgeMailboxState& state) {
	writer.u32(state.dataWord);
	writer.u32(state.controlWord);
	writer.boolean(state.irqPending);
}

CartridgeMailboxState readCartridgeMailboxState(BinaryReader& reader) {
	CartridgeMailboxState state;
	state.dataWord = reader.u32();
	state.controlWord = reader.u32();
	state.irqPending = reader.boolean();
	return state;
}

template<class Writer> void writeCartridgeCardState(Writer& writer, const CartridgeCardState& state) {
	writer.boolean(state.ram.has_value());
	if (state.ram) {
		writer.u32(static_cast<u32>(state.ram->size()));
		writer.bytes(*state.ram);
	}
	writer.boolean(state.mailbox.has_value());
	if (state.mailbox) {
		writeCartridgeMailboxState(writer, *state.mailbox);
	}
}

CartridgeCardState readCartridgeCardState(BinaryReader& reader) {
	CartridgeCardState state;
	if (reader.boolean()) {
		state.ram.emplace();
		*state.ram = reader.bytes(reader.u32());
	}
	if (reader.boolean()) {
		state.mailbox.emplace();
		*state.mailbox = readCartridgeMailboxState(reader);
	}
	return state;
}

template<class Writer> void writeCartridgeControllerState(Writer& writer, const CartridgeControllerState& state) {
	writer.u32(state.selectionWord);
	for (const auto& value : state.slots) {
		writer.boolean(value.has_value());
		if (value) {
			writeCartridgeCardState(writer, *value);
		}
	}
}

CartridgeControllerState readCartridgeControllerState(BinaryReader& reader) {
	CartridgeControllerState state;
	state.selectionWord = reader.u32();
	for (auto& value : state.slots) {
		if (reader.boolean()) {
			value.emplace();
			*value = readCartridgeCardState(reader);
		}
	}
	return state;
}

template<class Writer> void writeMemorySaveState(Writer& writer, const MemorySaveState& state) {
	writer.bytes(state.ram);
	writer.u32(state.busFaultCode);
	writer.u32(state.busFaultAddr);
	writer.u32(state.busFaultAccess);
}

MemorySaveState readMemorySaveState(BinaryReader& reader, size_t ramByteCount) {
	MemorySaveState state;
	state.ram = reader.bytes(ramByteCount);
	state.busFaultCode = reader.u32();
	state.busFaultAddr = reader.u32();
	state.busFaultAccess = reader.u32();
	return state;
}

template<class Writer> void writeIrqControllerState(Writer& writer, const IrqControllerState& state) {
	writer.u32(state.mask);
	writer.u32(state.pendingFlags);
	writer.u32(state.userMask);
	writer.u32(state.userPendingFlags);
	writer.boolean(state.supervisorContextActive);
}

IrqControllerState readIrqControllerState(BinaryReader& reader) {
	IrqControllerState state;
	state.mask = reader.u32();
	state.pendingFlags = reader.u32();
	state.userMask = reader.u32();
	state.userPendingFlags = reader.u32();
	state.supervisorContextActive = reader.boolean();
	return state;
}

template<class Writer> void writeStringPoolStateEntry(Writer& writer, const StringPoolStateEntry& state) {
	writer.u32(state.id);
	writer.string(state.value);
	writer.boolean(state.tracked);
}

StringPoolStateEntry readStringPoolStateEntry(BinaryReader& reader) {
	StringPoolStateEntry state;
	state.id = reader.u32();
	state.value = reader.string();
	state.tracked = reader.boolean();
	return state;
}

template<class Writer> void writeStringPoolState(Writer& writer, const StringPoolState& state) {
	writer.u32(static_cast<u32>(state.entries.size()));
	for (const auto& value : state.entries) {
		writeStringPoolStateEntry(writer, value);
	}
}

StringPoolState readStringPoolState(BinaryReader& reader) {
	StringPoolState state;
	const u32 entriesCount = reader.u32();
	state.entries.reserve(entriesCount);
	for (u32 index = 0; index < entriesCount; ++index) {
		state.entries.push_back(readStringPoolStateEntry(reader));
	}
	return state;
}

template<class Writer> void writeInputControllerRegisterState(Writer& writer, const InputControllerRegisterState& state) {
	writer.u32(state.ctrl);
	writer.u32s(state.keyWords);
	writer.u32(state.pointerButtons);
	writer.u32(state.pointerXQ16);
	writer.u32(state.pointerYQ16);
	writer.u32(state.pointerWheelQ16);
	writer.u32s(state.padButtons);
	writer.u32s(state.padAxesQ16);
	writer.u32(state.outputPort);
	writer.u32(state.outputIntensityQ16);
	writer.u32(state.outputDurationMs);
	writer.u32(state.outputStatus);
}

InputControllerRegisterState readInputControllerRegisterState(BinaryReader& reader) {
	InputControllerRegisterState state;
	state.ctrl = reader.u32();
	reader.u32s(state.keyWords);
	state.pointerButtons = reader.u32();
	state.pointerXQ16 = reader.u32();
	state.pointerYQ16 = reader.u32();
	state.pointerWheelQ16 = reader.u32();
	reader.u32s(state.padButtons);
	reader.u32s(state.padAxesQ16);
	state.outputPort = reader.u32();
	state.outputIntensityQ16 = reader.u32();
	state.outputDurationMs = reader.u32();
	state.outputStatus = reader.u32();
	return state;
}

template<class Writer> void writeInputControllerState(Writer& writer, const InputControllerState& state) {
	writer.boolean(state.sampleArmed);
	writer.u32(state.sampleSequence);
	writer.u32(state.lastSampleCycle);
	writer.boolean(state.supervisorRequestLineHigh);
	writeInputControllerRegisterState(writer, state.registers);
}

InputControllerState readInputControllerState(BinaryReader& reader) {
	InputControllerState state;
	state.sampleArmed = reader.boolean();
	state.sampleSequence = reader.u32();
	state.lastSampleCycle = reader.u32();
	state.supervisorRequestLineHigh = reader.boolean();
	state.registers = readInputControllerRegisterState(reader);
	return state;
}

template<class Writer> void writeGeometryJobState(Writer& writer, const GeometryJobState& state) {
	writer.u32(state.cmd);
	writer.u32(state.src0);
	writer.u32(state.src1);
	writer.u32(state.src2);
	writer.u32(state.dst0);
	writer.u32(state.dst1);
	writer.u32(state.count);
	writer.u32(state.param0);
	writer.u32(state.param1);
	writer.u32(state.stride0);
	writer.u32(state.stride1);
	writer.u32(state.stride2);
	writer.u32(state.processed);
	writer.u32(state.resultCount);
	writer.u32(state.exactPairCount);
	writer.u32(state.broadphasePairCount);
}

GeometryJobState readGeometryJobState(BinaryReader& reader) {
	GeometryJobState state;
	state.cmd = reader.u32();
	state.src0 = reader.u32();
	state.src1 = reader.u32();
	state.src2 = reader.u32();
	state.dst0 = reader.u32();
	state.dst1 = reader.u32();
	state.count = reader.u32();
	state.param0 = reader.u32();
	state.param1 = reader.u32();
	state.stride0 = reader.u32();
	state.stride1 = reader.u32();
	state.stride2 = reader.u32();
	state.processed = reader.u32();
	state.resultCount = reader.u32();
	state.exactPairCount = reader.u32();
	state.broadphasePairCount = reader.u32();
	return state;
}

template<class Writer> void writeGeometryControllerState(Writer& writer, const GeometryControllerState& state) {
	writer.u32(static_cast<u32>(state.phase));
	writer.u32s(state.registerWords);
	writer.boolean(state.activeJob.has_value());
	if (state.activeJob) {
		writeGeometryJobState(writer, *state.activeJob);
	}
	writer.i64(state.workCarry);
	writer.u32(state.availableWorkUnits);
	writer.boolean(state.supervisorQuiesceRequested);
}

GeometryControllerState readGeometryControllerState(BinaryReader& reader) {
	GeometryControllerState state;
	state.phase = static_cast<GeometryControllerPhase>(reader.u32());
	reader.u32s(state.registerWords);
	if (reader.boolean()) {
		state.activeJob.emplace();
		*state.activeJob = readGeometryJobState(reader);
	}
	state.workCarry = reader.i64();
	state.availableWorkUnits = reader.u32();
	state.supervisorQuiesceRequested = reader.boolean();
	return state;
}

template<class Writer> void writeGxGpuCommandBufferState(Writer& writer, const GxGpuCommandBufferState& state) {
	writer.u64(state.commandCount);
	writer.u64(state.executedCommandCount);
	writer.u64(state.presentCommandCount);
	writer.u64(state.wordCount);
	writer.u32(static_cast<u32>(state.commandKind.size()));
	writer.bytes(state.commandKind);
	writer.u32(static_cast<u32>(state.commandOpcode.size()));
	writer.bytes(state.commandOpcode);
	writer.u32(static_cast<u32>(state.commandWordStart.size()));
	writer.u32s(state.commandWordStart);
	writer.u32(static_cast<u32>(state.commandWordCount.size()));
	writer.u32s(state.commandWordCount);
	writer.u32(static_cast<u32>(state.commandDrawModeWord.size()));
	writer.u32s(state.commandDrawModeWord);
	writer.u32(static_cast<u32>(state.commandVramYAddressExtensionWord.size()));
	writer.bytes(state.commandVramYAddressExtensionWord);
	writer.u32(static_cast<u32>(state.commandTextureWindowWord.size()));
	writer.u32s(state.commandTextureWindowWord);
	writer.u32(static_cast<u32>(state.commandDrawingAreaTopLeftWord.size()));
	writer.u32s(state.commandDrawingAreaTopLeftWord);
	writer.u32(static_cast<u32>(state.commandDrawingAreaBottomRightWord.size()));
	writer.u32s(state.commandDrawingAreaBottomRightWord);
	writer.u32(static_cast<u32>(state.commandDrawingOffsetWord.size()));
	writer.u32s(state.commandDrawingOffsetWord);
	writer.u32(static_cast<u32>(state.commandMaskBitModeWord.size()));
	writer.u32s(state.commandMaskBitModeWord);
	writer.u32(static_cast<u32>(state.commandSkippedLineParity.size()));
	writer.bytes(state.commandSkippedLineParity);
	writer.u32(static_cast<u32>(state.words.size()));
	writer.u32s(state.words);
	writer.u8(state.readbackPhase);
	writer.u64(state.readbackFenceCommandCount);
	writer.u32(state.readbackX);
	writer.u32(state.readbackY);
	writer.u8(state.readbackVramYAddressExtensionWord);
	writer.u32(state.readbackWidth);
	writer.u32(state.readbackHeight);
	writer.u32(state.readbackPixelCursor);
	writer.u32(static_cast<u32>(state.readbackPixelBytes.size()));
	writer.bytes(state.readbackPixelBytes);
}

GxGpuCommandBufferState readGxGpuCommandBufferState(BinaryReader& reader) {
	GxGpuCommandBufferState state;
	state.commandCount = reader.u64();
	state.executedCommandCount = reader.u64();
	state.presentCommandCount = reader.u64();
	state.wordCount = reader.u64();
	state.commandKind = reader.bytes(reader.u32());
	state.commandOpcode = reader.bytes(reader.u32());
	state.commandWordStart = reader.u32s(reader.u32());
	state.commandWordCount = reader.u32s(reader.u32());
	state.commandDrawModeWord = reader.u32s(reader.u32());
	state.commandVramYAddressExtensionWord = reader.bytes(reader.u32());
	state.commandTextureWindowWord = reader.u32s(reader.u32());
	state.commandDrawingAreaTopLeftWord = reader.u32s(reader.u32());
	state.commandDrawingAreaBottomRightWord = reader.u32s(reader.u32());
	state.commandDrawingOffsetWord = reader.u32s(reader.u32());
	state.commandMaskBitModeWord = reader.u32s(reader.u32());
	state.commandSkippedLineParity = reader.bytes(reader.u32());
	state.words = reader.u32s(reader.u32());
	state.readbackPhase = reader.u8();
	state.readbackFenceCommandCount = reader.u64();
	state.readbackX = reader.u32();
	state.readbackY = reader.u32();
	state.readbackVramYAddressExtensionWord = reader.u8();
	state.readbackWidth = reader.u32();
	state.readbackHeight = reader.u32();
	state.readbackPixelCursor = reader.u32();
	state.readbackPixelBytes = reader.bytes(reader.u32());
	return state;
}

template<class Writer> void writeGxGpuRegisterContextState(Writer& writer, const GxGpuRegisterContextState& state) {
	writer.u32(state.gp0Word);
	writer.u32(state.gp1Word);
	writer.u32(state.displayModeWord);
	writer.u32(state.statusWord);
	writer.u32(state.gpuReadWord);
	writer.u32(state.drawModeWord);
	writer.u32(state.textureWindowWord);
	writer.u32(state.drawingAreaTopLeftWord);
	writer.u32(state.drawingAreaBottomRightWord);
	writer.u32(state.drawingOffsetWord);
	writer.u32(state.maskBitModeWord);
	writer.u32(state.displayStartWord);
	writer.u32(state.horizontalDisplayRangeWord);
	writer.u32(state.verticalDisplayRangeWord);
	writer.u32(state.vramYAddressExtensionWord);
	writer.u32(state.presentStatusWord);
	writer.u32(state.presentDisplayModeWord);
	writer.u32(state.presentDisplayStartWord);
	writer.u32(state.presentVramYAddressExtensionWord);
	writer.u32(state.presentHorizontalDisplayRangeWord);
	writer.u32(state.presentVerticalDisplayRangeWord);
	writer.u32s(state.pcrtcRegisterWords);
	writer.u32s(state.pcrtcPresentWords);
	writer.boolean(state.vramPresentationPending);
}

GxGpuRegisterContextState readGxGpuRegisterContextState(BinaryReader& reader) {
	GxGpuRegisterContextState state;
	state.gp0Word = reader.u32();
	state.gp1Word = reader.u32();
	state.displayModeWord = reader.u32();
	state.statusWord = reader.u32();
	state.gpuReadWord = reader.u32();
	state.drawModeWord = reader.u32();
	state.textureWindowWord = reader.u32();
	state.drawingAreaTopLeftWord = reader.u32();
	state.drawingAreaBottomRightWord = reader.u32();
	state.drawingOffsetWord = reader.u32();
	state.maskBitModeWord = reader.u32();
	state.displayStartWord = reader.u32();
	state.horizontalDisplayRangeWord = reader.u32();
	state.verticalDisplayRangeWord = reader.u32();
	state.vramYAddressExtensionWord = reader.u32();
	state.presentStatusWord = reader.u32();
	state.presentDisplayModeWord = reader.u32();
	state.presentDisplayStartWord = reader.u32();
	state.presentVramYAddressExtensionWord = reader.u32();
	state.presentHorizontalDisplayRangeWord = reader.u32();
	state.presentVerticalDisplayRangeWord = reader.u32();
	reader.u32s(state.pcrtcRegisterWords);
	reader.u32s(state.pcrtcPresentWords);
	state.vramPresentationPending = reader.boolean();
	return state;
}

template<class Writer> void writeGxGpuIngressContextState(Writer& writer, const GxGpuIngressContextState& state) {
	writer.u32(state.gp0CommandTargetWordCount);
	writer.u32(static_cast<u32>(state.gp0CommandWords.size()));
	writer.u32s(state.gp0CommandWords);
	writer.u32(state.gp0IngressPhase);
	writer.u32(state.gp0IngressWordsRemaining);
	writer.u32(state.gp0IngressPolylineWordsPerVertex);
	writer.u32(state.gp0IngressPolylinePayloadPhase);
	writer.u32(state.gp0ImageLoadWordsRemaining);
	writer.u64(state.gp0ImageLoadCommandWordStart);
	writer.u32(state.gp0ImageLoadCommandWordCount);
	writer.u8(state.gp0ImageLoadCommandOpcode);
	writer.u32(state.gp0PolylinePayloadPhase);
	writer.u8(state.gp0PolylineOpcode);
	writer.u32(state.gp0PolylineColorWord);
	writer.u32(state.gp0PolylinePositionWord);
	writer.u32(state.gp0PolylineNextColorWord);
	writer.u32(static_cast<u32>(state.commandBufferWords.size()));
	writer.u32s(state.commandBufferWords);
	writer.u8(state.readbackPhase);
	writer.u64(state.readbackFenceCommandCount);
	writer.u32(state.readbackX);
	writer.u32(state.readbackY);
	writer.u8(state.readbackVramYAddressExtensionWord);
	writer.u32(state.readbackWidth);
	writer.u32(state.readbackHeight);
	writer.u32(state.readbackPixelCursor);
	writer.u32(static_cast<u32>(state.readbackPixelBytes.size()));
	writer.bytes(state.readbackPixelBytes);
	writer.u32(static_cast<u32>(state.gp0FifoWords.size()));
	writer.u32s(state.gp0FifoWords);
	writer.u32(static_cast<u32>(state.gp0DmaIngressWords.size()));
	writer.u32s(state.gp0DmaIngressWords);
}

GxGpuIngressContextState readGxGpuIngressContextState(BinaryReader& reader) {
	GxGpuIngressContextState state;
	state.gp0CommandTargetWordCount = reader.u32();
	state.gp0CommandWords = reader.u32s(reader.u32());
	state.gp0IngressPhase = reader.u32();
	state.gp0IngressWordsRemaining = reader.u32();
	state.gp0IngressPolylineWordsPerVertex = reader.u32();
	state.gp0IngressPolylinePayloadPhase = reader.u32();
	state.gp0ImageLoadWordsRemaining = reader.u32();
	state.gp0ImageLoadCommandWordStart = reader.u64();
	state.gp0ImageLoadCommandWordCount = reader.u32();
	state.gp0ImageLoadCommandOpcode = reader.u8();
	state.gp0PolylinePayloadPhase = reader.u32();
	state.gp0PolylineOpcode = reader.u8();
	state.gp0PolylineColorWord = reader.u32();
	state.gp0PolylinePositionWord = reader.u32();
	state.gp0PolylineNextColorWord = reader.u32();
	state.commandBufferWords = reader.u32s(reader.u32());
	state.readbackPhase = reader.u8();
	state.readbackFenceCommandCount = reader.u64();
	state.readbackX = reader.u32();
	state.readbackY = reader.u32();
	state.readbackVramYAddressExtensionWord = reader.u8();
	state.readbackWidth = reader.u32();
	state.readbackHeight = reader.u32();
	state.readbackPixelCursor = reader.u32();
	state.readbackPixelBytes = reader.bytes(reader.u32());
	state.gp0FifoWords = reader.u32s(reader.u32());
	state.gp0DmaIngressWords = reader.u32s(reader.u32());
	return state;
}

template<class Writer> void writeGxGpuPcrtcState(Writer& writer, const GxGpuPcrtcState& state) {
	writer.u32s(state.registerWords);
	writer.u32s(state.presentWords);
	writer.u32(state.csrWord);
	writer.u32(state.imrWord);
	writer.i64(state.beamCycleOffset);
	writer.u32(state.beamRemainder);
	writer.u32(state.beamHalfLine);
	writer.u32(state.nextHsyncHalfLine);
	writer.u32(state.verticalStage);
	writer.boolean(state.vblankActive);
}

GxGpuPcrtcState readGxGpuPcrtcState(BinaryReader& reader) {
	GxGpuPcrtcState state;
	reader.u32s(state.registerWords);
	reader.u32s(state.presentWords);
	state.csrWord = reader.u32();
	state.imrWord = reader.u32();
	state.beamCycleOffset = reader.i64();
	state.beamRemainder = reader.u32();
	state.beamHalfLine = reader.u32();
	state.nextHsyncHalfLine = reader.u32();
	state.verticalStage = reader.u32();
	state.vblankActive = reader.boolean();
	return state;
}

template<class Writer> void writeGxGpuState(Writer& writer, const GxGpuState& state) {
	writer.u32(state.gp0Word);
	writer.u32(state.gp1Word);
	writer.u32(state.displayModeWord);
	writer.u32(state.statusWord);
	writer.u32(state.gp0CommandWordCount);
	writer.u32(state.gp0CommandTargetWordCount);
	writer.u32(static_cast<u32>(state.gp0CommandWords.size()));
	writer.u32s(state.gp0CommandWords);
	writer.u32(static_cast<u32>(state.gp0FifoWords.size()));
	writer.u32s(state.gp0FifoWords);
	writer.u32(static_cast<u32>(state.gp0DmaIngressWords.size()));
	writer.u32s(state.gp0DmaIngressWords);
	writer.u32(state.gp0IngressPhase);
	writer.u32(state.gp0IngressWordsRemaining);
	writer.u32(state.gp0IngressPolylineWordsPerVertex);
	writer.u32(state.gp0IngressPolylinePayloadPhase);
	writer.i64(state.pendingCommandCycles);
	writer.u64(state.pendingCommandTargetCount);
	writer.u32(state.gp0ImageLoadWordsRemaining);
	writer.u64(state.gp0ImageLoadCommandWordStart);
	writer.u32(state.gp0ImageLoadCommandWordCount);
	writer.u8(state.gp0ImageLoadCommandOpcode);
	writer.u32(state.gp0PolylinePayloadPhase);
	writer.u8(state.gp0PolylineOpcode);
	writer.u32(state.gp0PolylineColorWord);
	writer.u32(state.gp0PolylinePositionWord);
	writer.u32(state.gp0PolylineNextColorWord);
	writer.u32(state.gpuReadWord);
	writer.u32(state.drawModeWord);
	writer.u32(state.textureWindowWord);
	writer.u32(state.drawingAreaTopLeftWord);
	writer.u32(state.drawingAreaBottomRightWord);
	writer.u32(state.drawingOffsetWord);
	writer.u32(state.maskBitModeWord);
	writer.u32(state.displayStartWord);
	writer.u32(state.horizontalDisplayRangeWord);
	writer.u32(state.verticalDisplayRangeWord);
	writer.u32(state.vramYAddressExtensionWord);
	writer.u32(state.presentStatusWord);
	writer.u32(state.presentDisplayModeWord);
	writer.u32(state.presentDisplayStartWord);
	writer.u32(state.presentVramYAddressExtensionWord);
	writer.u32(state.presentHorizontalDisplayRangeWord);
	writer.u32(state.presentVerticalDisplayRangeWord);
	writeGxGpuPcrtcState(writer, state.pcrtc);
	writer.boolean(state.pcrtcPresentationPending);
	writer.boolean(state.vramPresentationPending);
	writer.boolean(state.supervisorQuiesceRequested);
	writer.boolean(state.supervisorIngressQuiesceRequested);
	writer.boolean(state.supervisorIngressStopped);
	writeGxGpuRegisterContextState(writer, state.userContext);
	writeGxGpuIngressContextState(writer, state.userIngressContext);
	writeGxGpuCommandBufferState(writer, state.commandBuffer);
}

GxGpuState readGxGpuState(BinaryReader& reader) {
	GxGpuState state;
	state.gp0Word = reader.u32();
	state.gp1Word = reader.u32();
	state.displayModeWord = reader.u32();
	state.statusWord = reader.u32();
	state.gp0CommandWordCount = reader.u32();
	state.gp0CommandTargetWordCount = reader.u32();
	state.gp0CommandWords = reader.u32s(reader.u32());
	state.gp0FifoWords = reader.u32s(reader.u32());
	state.gp0DmaIngressWords = reader.u32s(reader.u32());
	state.gp0IngressPhase = reader.u32();
	state.gp0IngressWordsRemaining = reader.u32();
	state.gp0IngressPolylineWordsPerVertex = reader.u32();
	state.gp0IngressPolylinePayloadPhase = reader.u32();
	state.pendingCommandCycles = reader.i64();
	state.pendingCommandTargetCount = reader.u64();
	state.gp0ImageLoadWordsRemaining = reader.u32();
	state.gp0ImageLoadCommandWordStart = reader.u64();
	state.gp0ImageLoadCommandWordCount = reader.u32();
	state.gp0ImageLoadCommandOpcode = reader.u8();
	state.gp0PolylinePayloadPhase = reader.u32();
	state.gp0PolylineOpcode = reader.u8();
	state.gp0PolylineColorWord = reader.u32();
	state.gp0PolylinePositionWord = reader.u32();
	state.gp0PolylineNextColorWord = reader.u32();
	state.gpuReadWord = reader.u32();
	state.drawModeWord = reader.u32();
	state.textureWindowWord = reader.u32();
	state.drawingAreaTopLeftWord = reader.u32();
	state.drawingAreaBottomRightWord = reader.u32();
	state.drawingOffsetWord = reader.u32();
	state.maskBitModeWord = reader.u32();
	state.displayStartWord = reader.u32();
	state.horizontalDisplayRangeWord = reader.u32();
	state.verticalDisplayRangeWord = reader.u32();
	state.vramYAddressExtensionWord = reader.u32();
	state.presentStatusWord = reader.u32();
	state.presentDisplayModeWord = reader.u32();
	state.presentDisplayStartWord = reader.u32();
	state.presentVramYAddressExtensionWord = reader.u32();
	state.presentHorizontalDisplayRangeWord = reader.u32();
	state.presentVerticalDisplayRangeWord = reader.u32();
	state.pcrtc = readGxGpuPcrtcState(reader);
	state.pcrtcPresentationPending = reader.boolean();
	state.vramPresentationPending = reader.boolean();
	state.supervisorQuiesceRequested = reader.boolean();
	state.supervisorIngressQuiesceRequested = reader.boolean();
	state.supervisorIngressStopped = reader.boolean();
	state.userContext = readGxGpuRegisterContextState(reader);
	state.userIngressContext = readGxGpuIngressContextState(reader);
	state.commandBuffer = readGxGpuCommandBufferState(reader);
	return state;
}

template<class Writer> void writeGxGpuSaveState(Writer& writer, const GxGpuSaveState& state) {
	writeGxGpuState(writer, state);
	writer.bytes(state.vramBytes);
}

GxGpuSaveState readGxGpuSaveState(BinaryReader& reader, size_t gxGpuVramByteCount) {
	GxGpuSaveState state;
	static_cast<GxGpuState&>(state) = readGxGpuState(reader);
	state.vramBytes = reader.bytes(gxGpuVramByteCount);
	return state;
}

template<class Writer> void writeGxGteState(Writer& writer, const GxGteState& state) {
	writer.u32s(state.dataRegisterWords);
	writer.u32s(state.controlRegisterWords);
	writer.u32s(state.plusRegisterWords);
	writer.i64(state.mac0);
	writer.i64(state.mac1);
	writer.i64(state.mac2);
	writer.i64(state.mac3);
	writer.u32(state.currentSf);
	writer.u32(state.lastCycles);
	writer.u32(state.plusPendingCycles);
	writer.boolean(state.plusInterlockArmed);
	writer.u32(state.plusPendingResultXy);
	writer.u32(state.plusPendingResultZ);
	writer.u32(state.plusPendingFlag);
}

GxGteState readGxGteState(BinaryReader& reader) {
	GxGteState state;
	reader.u32s(state.dataRegisterWords);
	reader.u32s(state.controlRegisterWords);
	reader.u32s(state.plusRegisterWords);
	state.mac0 = reader.i64();
	state.mac1 = reader.i64();
	state.mac2 = reader.i64();
	state.mac3 = reader.i64();
	state.currentSf = reader.u32();
	state.lastCycles = reader.u32();
	state.plusPendingCycles = reader.u32();
	state.plusInterlockArmed = reader.boolean();
	state.plusPendingResultXy = reader.u32();
	state.plusPendingResultZ = reader.u32();
	state.plusPendingFlag = reader.u32();
	return state;
}

template<class Writer> void writeApuBiquadFilterState(Writer& writer, const ApuBiquadFilterState& state) {
	writer.i32(state.l1);
	writer.i32(state.l2);
	writer.i32(state.r1);
	writer.i32(state.r2);
}

ApuBiquadFilterState readApuBiquadFilterState(BinaryReader& reader) {
	ApuBiquadFilterState state;
	state.l1 = reader.i32();
	state.l2 = reader.i32();
	state.r1 = reader.i32();
	state.r2 = reader.i32();
	return state;
}

template<class Writer> void writeApuBadpDecoderSaveState(Writer& writer, const ApuBadpDecoderSaveState& state) {
	writer.i32s(state.predictors);
	writer.i32s(state.stepIndices);
	writer.u32(state.nextFrame);
	writer.u32(state.blockEnd);
	writer.u32(state.blockFrames);
	writer.u32(state.blockFrameIndex);
	writer.u32(state.payloadOffset);
	writer.u32(state.nibbleCursor);
	writer.i64(state.decodedFrame);
	writer.i16(state.decodedLeft);
	writer.i16(state.decodedRight);
	writer.i64(state.previousDecodedFrame);
	writer.i16(state.previousDecodedLeft);
	writer.i16(state.previousDecodedRight);
}

ApuBadpDecoderSaveState readApuBadpDecoderSaveState(BinaryReader& reader) {
	ApuBadpDecoderSaveState state;
	reader.i32s(state.predictors);
	reader.i32s(state.stepIndices);
	state.nextFrame = reader.u32();
	state.blockEnd = reader.u32();
	state.blockFrames = reader.u32();
	state.blockFrameIndex = reader.u32();
	state.payloadOffset = reader.u32();
	state.nibbleCursor = reader.u32();
	state.decodedFrame = reader.i64();
	state.decodedLeft = reader.i16();
	state.decodedRight = reader.i16();
	state.previousDecodedFrame = reader.i64();
	state.previousDecodedLeft = reader.i16();
	state.previousDecodedRight = reader.i16();
	return state;
}

template<class Writer> void writeApuOutputVoiceState(Writer& writer, const ApuOutputVoiceState& state) {
	writer.u32(state.slot);
	writer.u32(state.sourceCartridgeSlot);
	writer.i64(state.cursorQ16);
	writer.i32(state.phaseRemainder);
	writer.i32(state.gainQ12);
	writer.i32(state.fadeStepQ12);
	writer.i32(state.fadeStepRemainder);
	writer.u32(state.fadeError);
	writer.u32(state.fadeSamplesRemaining);
	writer.u32(state.fadeSamplesTotal);
	writeApuBiquadFilterState(writer, state.filter);
	writeApuBadpDecoderSaveState(writer, state.badp);
}

ApuOutputVoiceState readApuOutputVoiceState(BinaryReader& reader) {
	ApuOutputVoiceState state;
	state.slot = reader.u32();
	state.sourceCartridgeSlot = reader.u32();
	state.cursorQ16 = reader.i64();
	state.phaseRemainder = reader.i32();
	state.gainQ12 = reader.i32();
	state.fadeStepQ12 = reader.i32();
	state.fadeStepRemainder = reader.i32();
	state.fadeError = reader.u32();
	state.fadeSamplesRemaining = reader.u32();
	state.fadeSamplesTotal = reader.u32();
	state.filter = readApuBiquadFilterState(reader);
	state.badp = readApuBadpDecoderSaveState(reader);
	return state;
}

template<class Writer> void writeApuCommandFifoState(Writer& writer, const ApuCommandFifoState& state) {
	writer.u32s(state.commands);
	writer.u32s(state.registerWords);
	writer.u32(state.readIndex);
	writer.u32(state.writeIndex);
	writer.u32(state.count);
}

ApuCommandFifoState readApuCommandFifoState(BinaryReader& reader) {
	ApuCommandFifoState state;
	reader.u32s(state.commands);
	reader.u32s(state.registerWords);
	state.readIndex = reader.u32();
	state.writeIndex = reader.u32();
	state.count = reader.u32();
	return state;
}

template<class Writer> void writeApuSampleTransferState(Writer& writer, const ApuSampleTransferState& state) {
	writer.u32s(state.fifoWords);
	writer.u32(state.fifoReadIndex);
	writer.u32(state.fifoWriteIndex);
	writer.u32(state.fifoCount);
	writer.u32(state.transferAddressWord);
	writer.u32(state.transferDataWord);
	writer.u32(state.transferControlWord);
	writer.u32(state.currentAddress);
	writer.i64(state.timingCarry);
	writer.u32(state.scheduledWords);
	writer.i64(state.scheduledCycles);
}

ApuSampleTransferState readApuSampleTransferState(BinaryReader& reader) {
	ApuSampleTransferState state;
	reader.u32s(state.fifoWords);
	state.fifoReadIndex = reader.u32();
	state.fifoWriteIndex = reader.u32();
	state.fifoCount = reader.u32();
	state.transferAddressWord = reader.u32();
	state.transferDataWord = reader.u32();
	state.transferControlWord = reader.u32();
	state.currentAddress = reader.u32();
	state.timingCarry = reader.i64();
	state.scheduledWords = reader.u32();
	state.scheduledCycles = reader.i64();
	return state;
}

template<class Writer> void writeApuOutputState(Writer& writer, const ApuOutputState& state) {
	writer.u32(static_cast<u32>(state.voices.size()));
	for (const auto& value : state.voices) {
		writeApuOutputVoiceState(writer, value);
	}
}

ApuOutputState readApuOutputState(BinaryReader& reader) {
	ApuOutputState state;
	const u32 voicesCount = reader.u32();
	state.voices.reserve(voicesCount);
	for (u32 index = 0; index < voicesCount; ++index) {
		state.voices.push_back(readApuOutputVoiceState(reader));
	}
	return state;
}

template<class Writer> void writeAudioControllerState(Writer& writer, const AudioControllerState& state) {
	writer.u32s(state.registerWords);
	writeApuCommandFifoState(writer, state.commandFifo);
	writer.u32(state.eventSequence);
	writer.u32(state.eventKind);
	writer.u32(state.eventSlot);
	writer.u32(state.eventSourceAddr);
	writer.u32s(state.slotPhases);
	writer.u32s(state.slotRegisterWords);
	writer.bytes(state.sampleRam);
	writeApuSampleTransferState(writer, state.sampleTransfer);
	writeApuOutputState(writer, state.output);
	writer.i64(state.sampleCarry);
	writer.i64(state.sampleSequence);
	writer.u32(state.apuStatus);
	writer.u32(state.apuFaultCode);
	writer.u32(state.apuFaultDetail);
}

AudioControllerState readAudioControllerState(BinaryReader& reader) {
	AudioControllerState state;
	reader.u32s(state.registerWords);
	state.commandFifo = readApuCommandFifoState(reader);
	state.eventSequence = reader.u32();
	state.eventKind = reader.u32();
	state.eventSlot = reader.u32();
	state.eventSourceAddr = reader.u32();
	reader.u32s(state.slotPhases);
	reader.u32s(state.slotRegisterWords);
	state.sampleRam = reader.bytes(APU_SAMPLE_RAM_BYTES);
	state.sampleTransfer = readApuSampleTransferState(reader);
	state.output = readApuOutputState(reader);
	state.sampleCarry = reader.i64();
	state.sampleSequence = reader.i64();
	state.apuStatus = reader.u32();
	state.apuFaultCode = reader.u32();
	state.apuFaultDetail = reader.u32();
	return state;
}

template<class Writer> void writeDmaChannelState(Writer& writer, const DmaChannelState& state) {
	writer.u32(state.readAddressWord);
	writer.u32(state.writeAddressWord);
	writer.u32(state.transferCountWord);
	writer.u32(state.controlWord);
	writer.u32(state.statusWord);
}

DmaChannelState readDmaChannelState(BinaryReader& reader) {
	DmaChannelState state;
	state.readAddressWord = reader.u32();
	state.writeAddressWord = reader.u32();
	state.transferCountWord = reader.u32();
	state.controlWord = reader.u32();
	state.statusWord = reader.u32();
	return state;
}

template<class Writer> void writeDmaControllerState(Writer& writer, const DmaControllerState& state) {
	for (const auto& value : state.channels) {
		writeDmaChannelState(writer, value);
	}
	writer.u32(state.activeChannel);
	writer.u32(state.nextChannel);
	writer.u32(state.scheduledBlockWords);
	writer.i64(state.scheduledBlockCycles);
	writer.u32(state.scheduledReadAddressWord);
	writer.u32(state.scheduledWriteAddressWord);
	writer.u32(state.scheduledTransferCountWord);
	writer.u32(state.scheduledControlWord);
	writer.boolean(state.supervisorQuiesceRequested);
	writer.boolean(state.supervisorAdmissionQuiesceRequested);
	for (const auto& value : state.userChannels) {
		writeDmaChannelState(writer, value);
	}
	writer.u32(state.userNextChannel);
}

DmaControllerState readDmaControllerState(BinaryReader& reader) {
	DmaControllerState state;
	for (auto& value : state.channels) {
		value = readDmaChannelState(reader);
	}
	state.activeChannel = reader.u32();
	state.nextChannel = reader.u32();
	state.scheduledBlockWords = reader.u32();
	state.scheduledBlockCycles = reader.i64();
	state.scheduledReadAddressWord = reader.u32();
	state.scheduledWriteAddressWord = reader.u32();
	state.scheduledTransferCountWord = reader.u32();
	state.scheduledControlWord = reader.u32();
	state.supervisorQuiesceRequested = reader.boolean();
	state.supervisorAdmissionQuiesceRequested = reader.boolean();
	for (auto& value : state.userChannels) {
		value = readDmaChannelState(reader);
	}
	state.userNextChannel = reader.u32();
	return state;
}

template<class Writer> void writeImgDecControllerState(Writer& writer, const ImgDecControllerState& state) {
	writer.u32(state.inputWordCountWord);
	writer.u32(state.textureDestinationWord);
	writer.u32(state.textureSizeWord);
	writer.u32(state.clutDestinationWord);
	writer.u32(state.controlWord);
	writer.u32(state.statusWord);
	writer.u32(state.dataWord);
	writer.u32(state.inputWordsReceived);
	writer.u32(state.decodedWordCount);
	writer.u32(state.textureWordCount);
	writer.u32(state.clutWordCount);
	writer.u32(state.outputWordsRead);
	writer.u32(state.decodePhase);
	writer.u32(state.outputStage);
	writer.u32(state.runWordsRemaining);
	writer.u32(state.repeatWord);
	writer.u32(state.backReferenceDistance);
	writer.boolean(state.supervisorQuiesceRequested);
	writer.u32(static_cast<u32>(state.inputWords.size()));
	writer.u32s(state.inputWords);
	writer.u32(static_cast<u32>(state.outputWords.size()));
	writer.u32s(state.outputWords);
	writer.u32(static_cast<u32>(state.historyWords.size()));
	writer.u32s(state.historyWords);
	writer.u32(state.scheduledDecodeWords);
	writer.i64(state.scheduledDecodeCycles);
}

ImgDecControllerState readImgDecControllerState(BinaryReader& reader) {
	ImgDecControllerState state;
	state.inputWordCountWord = reader.u32();
	state.textureDestinationWord = reader.u32();
	state.textureSizeWord = reader.u32();
	state.clutDestinationWord = reader.u32();
	state.controlWord = reader.u32();
	state.statusWord = reader.u32();
	state.dataWord = reader.u32();
	state.inputWordsReceived = reader.u32();
	state.decodedWordCount = reader.u32();
	state.textureWordCount = reader.u32();
	state.clutWordCount = reader.u32();
	state.outputWordsRead = reader.u32();
	state.decodePhase = reader.u32();
	state.outputStage = reader.u32();
	state.runWordsRemaining = reader.u32();
	state.repeatWord = reader.u32();
	state.backReferenceDistance = reader.u32();
	state.supervisorQuiesceRequested = reader.boolean();
	state.inputWords = reader.u32s(reader.u32());
	state.outputWords = reader.u32s(reader.u32());
	state.historyWords = reader.u32s(reader.u32());
	state.scheduledDecodeWords = reader.u32();
	state.scheduledDecodeCycles = reader.i64();
	return state;
}

template<class Writer> void writeSystemControllerState(Writer& writer, const SystemControllerState& state) {
	writer.boolean(state.resetRequested);
	writer.u8(state.supervisorPhase);
	writer.u8(state.supervisorTransitionTarget);
	writer.boolean(state.supervisorResumable);
	writer.boolean(state.supervisorExitRequested);
	writer.u32(state.supervisorFaultSequenceWord);
	writer.u32(state.supervisorFaultCauseWord);
	writer.u32(state.supervisorFaultEpcWord);
	writer.u32(state.supervisorFaultBadAddressWord);
	writer.u32(state.supervisorFaultLuaReasonWord);
	writer.u32(state.supervisorFaultDomainWord);
}

SystemControllerState readSystemControllerState(BinaryReader& reader) {
	SystemControllerState state;
	state.resetRequested = reader.boolean();
	state.supervisorPhase = reader.u8();
	state.supervisorTransitionTarget = reader.u8();
	state.supervisorResumable = reader.boolean();
	state.supervisorExitRequested = reader.boolean();
	state.supervisorFaultSequenceWord = reader.u32();
	state.supervisorFaultCauseWord = reader.u32();
	state.supervisorFaultEpcWord = reader.u32();
	state.supervisorFaultBadAddressWord = reader.u32();
	state.supervisorFaultLuaReasonWord = reader.u32();
	state.supervisorFaultDomainWord = reader.u32();
	return state;
}

template<class Writer> void writeSystemDebugTransmitState(Writer& writer, const SystemDebugTransmitState& state) {
	writer.u32(state.charWord);
	writer.u32(state.flushWord);
}

SystemDebugTransmitState readSystemDebugTransmitState(BinaryReader& reader) {
	SystemDebugTransmitState state;
	state.charWord = reader.u32();
	state.flushWord = reader.u32();
	return state;
}

template<class Writer> void writeMachineSaveState(Writer& writer, const MachineSaveState& state) {
	writeMemorySaveState(writer, state.memory);
	writeCartridgeControllerState(writer, state.cartridge);
	writeDmaControllerState(writer, state.dma);
	writeGeometryControllerState(writer, state.geometry);
	writeGxGpuSaveState(writer, state.gxGpu);
	writeGxGteState(writer, state.gxGte);
	writeIrqControllerState(writer, state.irq);
	writeAudioControllerState(writer, state.audio);
	writeStringPoolState(writer, state.stringPool);
	writeInputControllerState(writer, state.input);
	writeImgDecControllerState(writer, state.imgDec);
	writeSystemDebugTransmitState(writer, state.systemDebugTransmit);
	writeSystemControllerState(writer, state.systemControl);
}

MachineSaveState readMachineSaveState(BinaryReader& reader, size_t ramByteCount, size_t gxGpuVramByteCount) {
	MachineSaveState state;
	state.memory = readMemorySaveState(reader, ramByteCount);
	state.cartridge = readCartridgeControllerState(reader);
	state.dma = readDmaControllerState(reader);
	state.geometry = readGeometryControllerState(reader);
	state.gxGpu = readGxGpuSaveState(reader, gxGpuVramByteCount);
	state.gxGte = readGxGteState(reader);
	state.irq = readIrqControllerState(reader);
	state.audio = readAudioControllerState(reader);
	state.stringPool = readStringPoolState(reader);
	state.input = readInputControllerState(reader);
	state.imgDec = readImgDecControllerState(reader);
	state.systemDebugTransmit = readSystemDebugTransmitState(reader);
	state.systemControl = readSystemControllerState(reader);
	return state;
}

template<class Writer> void writeRuntimeSaveMachineState(Writer& writer, const RuntimeSaveMachineState& state) {
	writeMachineSaveState(writer, state.machine);
	writeFrameSchedulerStateSnapshot(writer, state.frameScheduler);
	writeFrameLoopStateSnapshot(writer, state.frameLoop);
	writer.i64(state.schedulerNowCycles);
}

RuntimeSaveMachineState readRuntimeSaveMachineState(BinaryReader& reader, size_t ramByteCount, size_t gxGpuVramByteCount) {
	RuntimeSaveMachineState state;
	state.machine = readMachineSaveState(reader, ramByteCount, gxGpuVramByteCount);
	state.frameScheduler = readFrameSchedulerStateSnapshot(reader);
	state.frameLoop = readFrameLoopStateSnapshot(reader);
	state.schedulerNowCycles = reader.i64();
	return state;
}

template<class Writer> void writeCpuFrameState(Writer& writer, const CpuFrameState& state) {
	writer.u32(state.functionAddress);
	writer.u32(state.pc);
	writer.i32(state.closureRef);
	writer.i32(state.stackCapacity);
	writer.u32(static_cast<u32>(state.registers.size()));
	writer.u32s(state.registers);
	writer.u32(static_cast<u32>(state.varargs.size()));
	writer.u32s(state.varargs);
	writer.i32(state.returnBase);
	writer.i32(state.returnCount);
	writer.i32(state.top);
	writer.boolean(state.returnToCompletionLatch);
	writer.u32(state.callSitePc);
	writer.boolean(state.isExceptionFrame);
	writer.boolean(state.isNonMaskableExceptionFrame);
}

CpuFrameState readCpuFrameState(BinaryReader& reader) {
	CpuFrameState state;
	state.functionAddress = reader.u32();
	state.pc = reader.u32();
	state.closureRef = reader.i32();
	state.stackCapacity = reader.i32();
	state.registers = reader.u32s(reader.u32());
	state.varargs = reader.u32s(reader.u32());
	state.returnBase = reader.i32();
	state.returnCount = reader.i32();
	state.top = reader.i32();
	state.returnToCompletionLatch = reader.boolean();
	state.callSitePc = reader.u32();
	state.isExceptionFrame = reader.boolean();
	state.isNonMaskableExceptionFrame = reader.boolean();
	return state;
}

template<class Writer> void writeCpuProtectedCallState(Writer& writer, const CpuProtectedCallState& state) {
	writer.u8(static_cast<u8>(state.kind));
	writer.i32(state.callerFrameIndex);
	writer.i32(state.targetFrameIndex);
	writer.boolean(state.returnsToProtectedParent);
	writer.i32(state.callBase);
	writer.i32(state.returnCount);
	writer.i32(state.handlerRegister);
}

CpuProtectedCallState readCpuProtectedCallState(BinaryReader& reader) {
	CpuProtectedCallState state;
	state.kind = static_cast<ProtectedCallKind>(reader.u8());
	state.callerFrameIndex = reader.i32();
	state.targetFrameIndex = reader.i32();
	state.returnsToProtectedParent = reader.boolean();
	state.callBase = reader.i32();
	state.returnCount = reader.i32();
	state.handlerRegister = reader.i32();
	return state;
}

template<class Writer> void writeCpuRootValueState(Writer& writer, const CpuRootValueState& state) {
	writer.u32(state.key);
	writer.u32(state.value);
}

CpuRootValueState readCpuRootValueState(BinaryReader& reader) {
	CpuRootValueState state;
	state.key = reader.u32();
	state.value = reader.u32();
	return state;
}

template<class Writer> void writeCpuThreadState(Writer& writer, const CpuThreadState& state) {
	writer.u8(static_cast<u8>(state.status));
	writer.i32(state.entryRef);
	writer.i32(state.resumerRef);
	writer.i32(state.callBase);
	writer.i32(state.returnCount);
	writer.u64(state.stackCapacity);
	writer.u32(state.error);
	writer.u32(static_cast<u32>(state.frames.size()));
	for (const auto& value : state.frames) {
		writeCpuFrameState(writer, value);
	}
	writer.u32(static_cast<u32>(state.protectedCalls.size()));
	for (const auto& value : state.protectedCalls) {
		writeCpuProtectedCallState(writer, value);
	}
	writer.u32(static_cast<u32>(state.openUpvalues.size()));
	writer.i32s(state.openUpvalues);
}

CpuThreadState readCpuThreadState(BinaryReader& reader) {
	CpuThreadState state;
	state.status = static_cast<ThreadStatus>(reader.u8());
	state.entryRef = reader.i32();
	state.resumerRef = reader.i32();
	state.callBase = reader.i32();
	state.returnCount = reader.i32();
	state.stackCapacity = reader.u64();
	state.error = reader.u32();
	const u32 framesCount = reader.u32();
	state.frames.reserve(framesCount);
	for (u32 index = 0; index < framesCount; ++index) {
		state.frames.push_back(readCpuFrameState(reader));
	}
	const u32 protectedCallsCount = reader.u32();
	state.protectedCalls.reserve(protectedCallsCount);
	for (u32 index = 0; index < protectedCallsCount; ++index) {
		state.protectedCalls.push_back(readCpuProtectedCallState(reader));
	}
	state.openUpvalues = reader.i32s(reader.u32());
	return state;
}

template<class Writer> void writeCpuSnapshot(Writer& writer, const CpuSnapshot& state) {
	writer.u32(static_cast<u32>(state.words().size()));
	writer.u32s(state.words());
	writer.u32(static_cast<u32>(state.objectWords().size()));
	writer.u32s(state.objectWords());
}

CpuSnapshot readCpuSnapshot(BinaryReader& reader) {
	auto words = reader.u32s(reader.u32());
	auto objectWords = reader.u32s(reader.u32());
	return CpuSnapshot(std::move(words), std::move(objectWords));
}

template<class Writer> void writeLuaHeapState(Writer& writer, const LuaHeapState& state) {
	writer.u64(state.trackedBytes);
	writer.u64(state.nextCollectionBytes);
}

LuaHeapState readLuaHeapState(BinaryReader& reader) {
	LuaHeapState state;
	state.trackedBytes = reader.u64();
	state.nextCollectionBytes = reader.u64();
	return state;
}

template<class Writer> void writeCpuRuntimeState(Writer& writer, const CpuRuntimeState& state) {
	writer.i32(state.executionCartridgeSlot);
	writer.u32(static_cast<u32>(state.systemGlobals.size()));
	for (const auto& value : state.systemGlobals) {
		writeCpuRootValueState(writer, value);
	}
	writer.u32(static_cast<u32>(state.globalSlots.size()));
	for (const auto& value : state.globalSlots) {
		writeCpuRootValueState(writer, value);
	}
	writer.u32(state.stringIndexTable);
	writer.i32(state.rootThreadRef);
	writer.i32(state.activeThreadRef);
	writer.i32(state.completionThreadRef);
	writer.u32(static_cast<u32>(state.threads.size()));
	for (const auto& value : state.threads) {
		writeCpuThreadState(writer, value);
	}
	writer.u32(static_cast<u32>(state.completionValues.size()));
	writer.u32s(state.completionValues);
	writeCpuSnapshot(writer, state.snapshot);
	writer.i32(state.lastExecutionDomainId);
	writer.u32(state.executionResidencyMask);
	writer.u32(state.nextObjectHashId);
	writer.boolean(state.hardHalted);
	writeLuaHeapState(writer, state.luaHeap);
	writer.u32(state.lastPc);
	writer.i32(state.haltedUntilIrqThreadRef);
	writer.i32(state.haltedUntilIrqFrameDepth);
	writer.boolean(state.interruptEventPending);
	writer.boolean(state.memoryWriteBlocked);
	writer.u32(state.memoryWriteBlockedAddress);
	writer.u32(state.statusWord);
	writer.u32(state.causeWord);
	writer.u32(state.epcWord);
	writer.u32(state.badAddressWord);
	writer.u32(state.luaFaultReasonWord);
	writer.u32(state.exceptionDomainWord);
	writer.u32(state.nmiReturnCauseWord);
	writer.u32(state.nmiReturnEpcWord);
	writer.u32(state.nmiReturnBadAddressWord);
	writer.u32(state.nmiReturnLuaFaultReasonWord);
	writer.u32(state.nmiReturnExceptionDomainWord);
	writer.boolean(state.nonMaskableInterruptPending);
	writer.boolean(state.yieldRequested);
}

CpuRuntimeState readCpuRuntimeState(BinaryReader& reader) {
	CpuRuntimeState state;
	state.executionCartridgeSlot = reader.i32();
	const u32 systemGlobalsCount = reader.u32();
	state.systemGlobals.reserve(systemGlobalsCount);
	for (u32 index = 0; index < systemGlobalsCount; ++index) {
		state.systemGlobals.push_back(readCpuRootValueState(reader));
	}
	const u32 globalSlotsCount = reader.u32();
	state.globalSlots.reserve(globalSlotsCount);
	for (u32 index = 0; index < globalSlotsCount; ++index) {
		state.globalSlots.push_back(readCpuRootValueState(reader));
	}
	state.stringIndexTable = reader.u32();
	state.rootThreadRef = reader.i32();
	state.activeThreadRef = reader.i32();
	state.completionThreadRef = reader.i32();
	const u32 threadsCount = reader.u32();
	state.threads.reserve(threadsCount);
	for (u32 index = 0; index < threadsCount; ++index) {
		state.threads.push_back(readCpuThreadState(reader));
	}
	state.completionValues = reader.u32s(reader.u32());
	state.snapshot = readCpuSnapshot(reader);
	state.lastExecutionDomainId = reader.i32();
	state.executionResidencyMask = reader.u32();
	state.nextObjectHashId = reader.u32();
	state.hardHalted = reader.boolean();
	state.luaHeap = readLuaHeapState(reader);
	state.lastPc = reader.u32();
	state.haltedUntilIrqThreadRef = reader.i32();
	state.haltedUntilIrqFrameDepth = reader.i32();
	state.interruptEventPending = reader.boolean();
	state.memoryWriteBlocked = reader.boolean();
	state.memoryWriteBlockedAddress = reader.u32();
	state.statusWord = reader.u32();
	state.causeWord = reader.u32();
	state.epcWord = reader.u32();
	state.badAddressWord = reader.u32();
	state.luaFaultReasonWord = reader.u32();
	state.exceptionDomainWord = reader.u32();
	state.nmiReturnCauseWord = reader.u32();
	state.nmiReturnEpcWord = reader.u32();
	state.nmiReturnBadAddressWord = reader.u32();
	state.nmiReturnLuaFaultReasonWord = reader.u32();
	state.nmiReturnExceptionDomainWord = reader.u32();
	state.nonMaskableInterruptPending = reader.boolean();
	state.yieldRequested = reader.boolean();
	return state;
}

template<class Writer> void writeRuntimeSaveState(Writer& writer, const RuntimeSaveState& state) {
	writeRuntimeSaveMachineState(writer, state.machineState);
	writeCpuRuntimeState(writer, state.cpuState);
	writer.boolean(state.pendingEntryCall);
}

RuntimeSaveState readRuntimeSaveState(BinaryReader& reader, size_t ramByteCount, size_t gxGpuVramByteCount) {
	RuntimeSaveState state;
	state.machineState = readRuntimeSaveMachineState(reader, ramByteCount, gxGpuVramByteCount);
	state.cpuState = readCpuRuntimeState(reader);
	state.pendingEntryCall = reader.boolean();
	return state;
}

template<class Writer> void writeStateImage(Writer& writer, const RuntimeSaveState& state) {
	writer.u32(kSaveStateSignature);
	writeRuntimeSaveState(writer, state);
}

} // namespace

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state) {
	BinarySize size;
	writeStateImage(size, state);
	std::vector<u8> output(size.length);
	BinaryWriter writer(output);
	writeStateImage(writer, state);
	return output;
}

size_t encodeRuntimeSaveState(const RuntimeSaveState& state, std::span<u8> output) {
	BinarySize size;
	writeStateImage(size, state);
	if (size.length > output.size()) return 0;
	BinaryWriter writer(output);
	writeStateImage(writer, state);
	return writer.length;
}

RuntimeSaveState decodeRuntimeSaveState(std::span<const u8> data, size_t ramByteCount, size_t gxGpuVramByteCount) {
	BinaryReader reader(data);
	if (reader.u32() != kSaveStateSignature) throw BMSX_RUNTIME_ERROR("Unrecognized save-state format.");
	auto state = readRuntimeSaveState(reader, ramByteCount, gxGpuVramByteCount);
	reader.finish();
	return state;
}

} // namespace bmsx
