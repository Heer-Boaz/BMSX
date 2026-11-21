#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binary_stream.h"
#include "spec/audio/apu.h"

namespace bmsx {
namespace {

// One current internal layout, deliberately without a legacy reader.
// TODO: MUST BE FIXED TO `BMSX` INSTEAD OF CHANGING THE SIGNATURE AFTER EACH VERSION! WE ARE NOT DOING VERSIONING!
constexpr u32 kSaveStateSignature = 0x5a534d42u; // BMSZ: resumable String intern-bucket sweep

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

template<class Writer> void writeMemoryBusState(Writer& writer, const MemoryBusState& state) {
	writer.u32(state.ramBusEnd);
	writer.u32(state.busFaultCode);
	writer.u32(state.busFaultAddr);
	writer.u32(state.busFaultAccess);
}

MemoryBusState readMemoryBusState(BinaryReader& reader) {
	MemoryBusState state;
	state.ramBusEnd = reader.u32();
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

template<class Writer> void writeGeometryOverlapProgress(Writer& writer, const GeometryOverlap2dProgress& state) {
	writer.u32(state.phase); writer.u32(state.instanceBIndex); writer.u32(state.pairMeta);
	writer.u32(state.shapeAAddr); writer.u32(state.shapeBAddr);
	writer.u32(state.shapeAOffset); writer.u32(state.shapeBOffset);
	writer.u32(state.countA); writer.u32(state.countB); writer.u32(state.pieceA); writer.u32(state.pieceB);
	writer.boolean(state.compoundA); writer.boolean(state.compoundB); writer.boolean(state.bestHit);
	writer.u32(state.bestPieceA); writer.u32(state.bestPieceB); writer.u32(state.bestFeature);
	writer.f64(state.bestDepth); writer.f64(state.bestNx); writer.f64(state.bestNy);
	writer.f64(state.bestPx); writer.f64(state.bestPy);
	writer.u32s(state.instanceA); writer.u32s(state.instanceB);
	for (double value : state.boundsA) writer.f64(value);
	writer.u32(state.pendingWork.axes); writer.u32(state.pendingWork.projectionVertices);
	writer.u32(state.pendingWork.averageVertices); writer.u32(state.pendingWork.clipVertices);
	writer.u32(state.pendingWork.clipEdges); writer.u32(state.pendingWork.squareRoots);
	writer.u32(state.pendingWork.divisions);
	writer.u32(state.pendingWriteFlags); writer.u32(state.afterPublishPhase);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingFault);
}

GeometryOverlap2dProgress readGeometryOverlapProgress(BinaryReader& reader) {
	GeometryOverlap2dProgress state;
	state.phase = reader.u32(); state.instanceBIndex = reader.u32(); state.pairMeta = reader.u32();
	state.shapeAAddr = reader.u32(); state.shapeBAddr = reader.u32();
	state.shapeAOffset = reader.u32(); state.shapeBOffset = reader.u32();
	state.countA = reader.u32(); state.countB = reader.u32(); state.pieceA = reader.u32(); state.pieceB = reader.u32();
	state.compoundA = reader.boolean(); state.compoundB = reader.boolean(); state.bestHit = reader.boolean();
	state.bestPieceA = reader.u32(); state.bestPieceB = reader.u32(); state.bestFeature = reader.u32();
	state.bestDepth = reader.f64(); state.bestNx = reader.f64(); state.bestNy = reader.f64();
	state.bestPx = reader.f64(); state.bestPy = reader.f64();
	reader.u32s(state.instanceA); reader.u32s(state.instanceB);
	for (double& value : state.boundsA) value = reader.f64();
	state.pendingWork.axes = reader.u32(); state.pendingWork.projectionVertices = reader.u32();
	state.pendingWork.averageVertices = reader.u32(); state.pendingWork.clipVertices = reader.u32();
	state.pendingWork.clipEdges = reader.u32(); state.pendingWork.squareRoots = reader.u32();
	state.pendingWork.divisions = reader.u32();
	state.pendingWriteFlags = reader.u32(); state.afterPublishPhase = reader.u32();
	state.pendingMemory.ramWords = reader.u32(); state.pendingMemory.systemRomWords = reader.u32();
	state.pendingMemory.cartridgeWords = reader.u32(); state.pendingMemory.otherWords = reader.u32();
	state.pendingFault = reader.u32();
	return state;
}

template<class Writer> void writeGeometryXformProgress(Writer& writer, const GeometryXform2Progress& state) {
	writer.u32(state.phase);
	writer.u32(state.dstAddress); writer.u32(state.boundsAddress);
	writer.u32(state.vertexCount); writer.boolean(state.hasBounds);
	writer.u32s(state.vertices); writer.u32s(state.bounds);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingWorkUnits); writer.u32(state.pendingFault);
}

GeometryXform2Progress readGeometryXformProgress(BinaryReader& reader) {
	GeometryXform2Progress state;
	state.phase = reader.u32();
	state.dstAddress = reader.u32(); state.boundsAddress = reader.u32();
	state.vertexCount = reader.u32(); state.hasBounds = reader.boolean();
	reader.u32s(state.vertices); reader.u32s(state.bounds);
	state.pendingMemory.ramWords = reader.u32(); state.pendingMemory.systemRomWords = reader.u32();
	state.pendingMemory.cartridgeWords = reader.u32(); state.pendingMemory.otherWords = reader.u32();
	state.pendingWorkUnits = reader.u32(); state.pendingFault = reader.u32();
	return state;
}

template<class Writer> void writeGeometrySatProgress(Writer& writer, const GeometrySat2Progress& state) {
	writer.u32(state.phase);
	writer.u32(state.vertexAddressA); writer.u32(state.vertexAddressB);
	writer.u32(state.countA); writer.u32(state.countB); writer.u32(state.resultAddress);
	writer.u32s(state.verticesA); writer.u32s(state.verticesB); writer.u32s(state.result);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingWorkUnits); writer.u32(state.pendingFault);
}

GeometrySat2Progress readGeometrySatProgress(BinaryReader& reader) {
	GeometrySat2Progress state;
	state.phase = reader.u32();
	state.vertexAddressA = reader.u32(); state.vertexAddressB = reader.u32();
	state.countA = reader.u32(); state.countB = reader.u32(); state.resultAddress = reader.u32();
	reader.u32s(state.verticesA); reader.u32s(state.verticesB); reader.u32s(state.result);
	state.pendingMemory.ramWords = reader.u32(); state.pendingMemory.systemRomWords = reader.u32();
	state.pendingMemory.cartridgeWords = reader.u32(); state.pendingMemory.otherWords = reader.u32();
	state.pendingWorkUnits = reader.u32(); state.pendingFault = reader.u32();
	return state;
}

template<class Writer> void writeGeometryControllerState(Writer& writer, const GeometryControllerState& state) {
	writer.u32(static_cast<u32>(state.phase));
	writer.u32s(state.registerWords);
	writer.boolean(state.activeJob.has_value());
	if (state.activeJob) {
		writeGeometryJobState(writer, *state.activeJob);
	}
	writeGeometryXformProgress(writer, state.xform);
	writeGeometrySatProgress(writer, state.sat);
	writeGeometryOverlapProgress(writer, state.overlap);
	writer.i64(state.workCarry);
	writer.i64(state.pendingCycles);
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
	state.xform = readGeometryXformProgress(reader);
	state.sat = readGeometrySatProgress(reader);
	state.overlap = readGeometryOverlapProgress(reader);
	state.workCarry = reader.i64();
	state.pendingCycles = reader.i64();
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
	writer.u32s(state.commandVramYAddressExtensionWord);
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
	writer.u32(state.readbackVramYAddressExtensionWord);
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
	state.commandVramYAddressExtensionWord = reader.u32s(reader.u32());
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
	state.readbackVramYAddressExtensionWord = reader.u32();
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
	writer.u32(state.readbackVramYAddressExtensionWord);
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
	state.readbackVramYAddressExtensionWord = reader.u32();
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
	writer.u32(state.normalPendingCycles);
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
	state.normalPendingCycles = reader.u32();
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
	writer.u32(state.outputWordCountWord);
	writer.u32(state.controlWord);
	writer.u32(state.statusWord);
	writer.u32(state.dataWord);
	writer.u32(state.inputWordsReceived);
	writer.u32(state.decodedWordCount);
	writer.u32(state.outputWordsRead);
	writer.u32(state.decodePhase);
	writer.u32(state.runWordsRemaining);
	writer.u32(state.repeatWord);
	writer.u32(state.backReferenceDistance);
	writer.u32(state.blockPhase);
	writer.u32(state.blockReadIndex);
	writer.i64(state.blockCyclesRemaining);
	writer.boolean(state.supervisorQuiesceRequested);
	writer.u32(static_cast<u32>(state.inputWords.size()));
	writer.u32s(state.inputWords);
	writer.u32(static_cast<u32>(state.blockWords.size()));
	writer.u32s(state.blockWords);
	writer.u32(static_cast<u32>(state.historyWords.size()));
	writer.u32s(state.historyWords);
}

ImgDecControllerState readImgDecControllerState(BinaryReader& reader) {
	ImgDecControllerState state;
	state.inputWordCountWord = reader.u32();
	state.outputWordCountWord = reader.u32();
	state.controlWord = reader.u32();
	state.statusWord = reader.u32();
	state.dataWord = reader.u32();
	state.inputWordsReceived = reader.u32();
	state.decodedWordCount = reader.u32();
	state.outputWordsRead = reader.u32();
	state.decodePhase = reader.u32();
	state.runWordsRemaining = reader.u32();
	state.repeatWord = reader.u32();
	state.backReferenceDistance = reader.u32();
	state.blockPhase = reader.u32();
	state.blockReadIndex = reader.u32();
	state.blockCyclesRemaining = reader.i64();
	state.supervisorQuiesceRequested = reader.boolean();
	state.inputWords = reader.u32s(reader.u32());
	state.blockWords = reader.u32s(reader.u32());
	state.historyWords = reader.u32s(reader.u32());
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
	writeMemoryBusState(writer, state.memory);
	writeCartridgeControllerState(writer, state.cartridge);
	writeDmaControllerState(writer, state.dma);
	writeGeometryControllerState(writer, state.geometry);
	writeGxGpuSaveState(writer, state.gxGpu);
	writeGxGteState(writer, state.gxGte);
	writeIrqControllerState(writer, state.irq);
	writeAudioControllerState(writer, state.audio);
	writeInputControllerState(writer, state.input);
	writeImgDecControllerState(writer, state.imgDec);
	writeSystemDebugTransmitState(writer, state.systemDebugTransmit);
	writeSystemControllerState(writer, state.systemControl);
}

MachineSaveState readMachineSaveState(BinaryReader& reader, size_t gxGpuVramByteCount) {
	MachineSaveState state;
	state.memory = readMemoryBusState(reader);
	state.cartridge = readCartridgeControllerState(reader);
	state.dma = readDmaControllerState(reader);
	state.geometry = readGeometryControllerState(reader);
	state.gxGpu = readGxGpuSaveState(reader, gxGpuVramByteCount);
	state.gxGte = readGxGteState(reader);
	state.irq = readIrqControllerState(reader);
	state.audio = readAudioControllerState(reader);
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

RuntimeSaveMachineState readRuntimeSaveMachineState(BinaryReader& reader, size_t gxGpuVramByteCount) {
	RuntimeSaveMachineState state;
	state.machine = readMachineSaveState(reader, gxGpuVramByteCount);
	state.frameScheduler = readFrameSchedulerStateSnapshot(reader);
	state.frameLoop = readFrameLoopStateSnapshot(reader);
	state.schedulerNowCycles = reader.i64();
	return state;
}

template<class Writer> void writeCpuRuntimeState(Writer& writer, const CpuRuntimeState& state) {
	writer.i32(state.executionCartridgeSlot);
	writer.i32(state.programExecutionDomainId);
	writer.u32(state.systemGlobals.base);
	writer.u32(state.systemGlobals.capacity);
	writer.u32(state.systemGlobals.count);
	writer.u32(state.globals.base);
	writer.u32(state.globals.capacity);
	writer.u32(state.globals.count);
	writer.u64(state.stringIndexTable);
	writer.u32(state.rootThreadAddress);
	writer.u32(state.activeThreadAddress);
	writer.u32(state.completionThreadAddress);
	writer.u32(static_cast<u32>(state.completionValues.size()));
	writer.u64s(state.completionValues);
	writer.i32(state.lastExecutionDomainId);
	writer.u32(state.executionResidencyMask);
	writer.u32s(state.constantPoolBases);
	writer.u32s(state.globalMapBases);
	writer.boolean(state.hardHalted);
	writer.u32(state.lastPc);
	writer.u32(state.haltedUntilIrqThreadAddress);
	writer.i32(state.haltedUntilIrqFrameDepth);
	writer.boolean(state.interruptEventPending);
	writer.boolean(state.memoryWriteBlocked);
	writer.u32(state.memoryWriteBlockedAddress);
	writer.u32(static_cast<u32>(state.pendingMemory.kind));
	writer.u32(state.pendingMemory.instructionPc);
	writer.u32(state.pendingMemory.nextPc);
	writer.u32(state.pendingMemory.address);
	writer.u32(static_cast<u32>(state.pendingMemory.accessKind));
	writer.i32(state.pendingMemory.registerIndex);
	writer.i32(state.pendingMemory.wordCount);
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
	state.programExecutionDomainId = reader.i32();
	state.systemGlobals = {reader.u32(), reader.u32(), reader.u32()};
	state.globals = {reader.u32(), reader.u32(), reader.u32()};
	state.stringIndexTable = reader.u64();
	state.rootThreadAddress = reader.u32();
	state.activeThreadAddress = reader.u32();
	state.completionThreadAddress = reader.u32();
	state.completionValues = reader.u64s(reader.u32());
	state.lastExecutionDomainId = reader.i32();
	state.executionResidencyMask = reader.u32();
	reader.u32s(state.constantPoolBases);
	reader.u32s(state.globalMapBases);
	state.hardHalted = reader.boolean();
	state.lastPc = reader.u32();
	state.haltedUntilIrqThreadAddress = reader.u32();
	state.haltedUntilIrqFrameDepth = reader.i32();
	state.interruptEventPending = reader.boolean();
	state.memoryWriteBlocked = reader.boolean();
	state.memoryWriteBlockedAddress = reader.u32();
	state.pendingMemory.kind = static_cast<PendingMemoryKind>(reader.u32());
	state.pendingMemory.instructionPc = reader.u32();
	state.pendingMemory.nextPc = reader.u32();
	state.pendingMemory.address = reader.u32();
	state.pendingMemory.accessKind = static_cast<MemoryAccessKind>(reader.u32());
	state.pendingMemory.registerIndex = reader.i32();
	state.pendingMemory.wordCount = reader.i32();
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
	writer.bytes(state.ram);
	writeRuntimeSaveMachineState(writer, state.machineState);
	writeCpuRuntimeState(writer, state.cpuState);
	writer.boolean(state.pendingEntryCall);
}

RuntimeSaveState readRuntimeSaveState(BinaryReader& reader, size_t ramByteCount, size_t gxGpuVramByteCount) {
	RuntimeSaveState state;
	state.ram = reader.bytes(ramByteCount);
	state.machineState = readRuntimeSaveMachineState(reader, gxGpuVramByteCount);
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
