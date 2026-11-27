import { TableCensus } from '../../cpu/table';
import { LuaAllocationRecovery } from '../../cpu/lua_heap';
import type { PendingMemoryKind } from '../../cpu/memory_operation';
import type { MemoryAccessKind } from '../../../spec/blua32/memory_access_kind';
import { BinaryReader, BinarySize, BinaryWriter, type BinarySink } from '../../../common/serializer/binary_stream';
import type { MachineSaveState } from '../../save_state';
import { AllocationRecovery, type CpuRuntimeState, type PendingAllocation } from '../../cpu/cpu';
import type { Value } from '../../cpu/value';
import type { IrqControllerState } from '../../devices/irq/save_state';
import type { CartridgeCardState, CartridgeControllerState, CartridgeMailboxState } from '../../devices/cartridge/contracts';
import type { AudioControllerState, ApuBadpDecoderSaveState, ApuBiquadFilterState, ApuOutputState, ApuOutputVoiceState, ApuSampleTransferState } from '../../devices/audio/save_state';
import type { ApuCommandFifoState } from '../../devices/audio/command_fifo';
import type { DmaControllerState } from '../../devices/dma/controller';
import type { DmaChannelState } from '../../devices/dma/registers';
import type { GeometryControllerPhase } from '../../devices/geometry/contracts';
import type { GeometryJobState } from '../../devices/geometry/job';
import type { GeometryOverlap2dPhase, GeometryOverlap2dProgress } from '../../devices/geometry/overlap2d';
import type { GeometryControllerState } from '../../devices/geometry/save_state';
import type { GeometryXform2Phase, GeometryXform2Progress } from '../../devices/geometry/xform2';
import type { GeometrySat2Phase, GeometrySat2Progress } from '../../devices/geometry/sat2';
import type { InputControllerState } from '../../devices/input/save_state';
import type { InputControllerRegisterState } from '../../devices/input/registers';
import type { ImgDecControllerState } from '../../devices/imgdec/controller';
import type { SystemControllerState } from '../../devices/system/controller';
import type { SystemDebugTransmitState } from '../../devices/system/debug_transmit';
import type { GxGpuIngressContextState, GxGpuRegisterContextState, GxGpuSaveState, GxGpuState } from '../../devices/gx/gpu';
import type { GxGpuCommandBufferState } from '../../devices/gx/gpu_command_buffer';
import type { GxGpuPcrtcState } from '../../devices/gx/gpu_pcrtc';
import type { GxGteState } from '../../devices/gx/gte';
import type { MemoryBusState } from '../../memory/memory';
import type { FrameSchedulerStateSnapshot } from '../../scheduler/frame';
import type { FrameLoopStateSnapshot } from '../frame/loop';
import type { FrameState } from '../frame/state';
import type { RuntimeSaveMachineState } from '../save_machine_state';
import type { RuntimeSaveState } from '../save_state';
import type { ExecutionDomainId } from '../../../spec/blua32/execution_domain';
import { APU_COMMAND_FIFO_CAPACITY, APU_COMMAND_FIFO_REGISTER_WORD_COUNT, APU_PARAMETER_REGISTER_COUNT, APU_SAMPLE_RAM_BYTES, APU_SLOT_COUNT, APU_SLOT_REGISTER_WORD_COUNT, APU_TRANSFER_FIFO_WORD_CAPACITY } from '../../../spec/audio/apu';
import { GEOMETRY_CONTROLLER_REGISTER_COUNT, GEO_OVERLAP2D_INSTANCE_WORDS, GEO_SAT2_MAX_POLY_VERTICES,
	GEO_SAT2_RESULT_BYTES, GEO_XFORM2_AABB_BYTES, GEO_XFORM2_MAX_VERTICES, GEO_VERTEX2_BYTES } from '../../devices/geometry/contracts';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../devices/input/contracts';
import { GX_GPU_PCRTC_COMPOSITION_WORD_COUNT, GX_GPU_PCRTC_CONFIG_WORD_COUNT } from '../../../spec/gx/pcrtc';
import { GX_GTE_CONTROL_REGISTER_COUNT, GX_GTE_DATA_REGISTER_COUNT, GX_GTE_PLUS_REGISTER_COUNT } from '../../devices/gx/gte';

// BMSX identifies the container. Only the current payload layout is accepted.
const SAVE_STATE_SIGNATURE = 0x32534d42;

function writeFrameSchedulerStateSnapshot(writer: BinarySink, state: FrameSchedulerStateSnapshot): void {
	writer.f64(state.accumulatedHostTimeMs);
	writer.f64(state.cycleGrantRemainder);
	writer.i64(state.carriedCycleBudget);
	writer.bool(state.tickCompletionPending);
	writer.bool(state.tickCompletionVisualCommitted);
	writer.bool(state.logicalTickRunPending);
	writer.i64(state.logicalTickRunTargetSequence);
	writer.i64(state.lastTickSequence);
	writer.i64(state.lastTickBudgetGranted);
	writer.i64(state.lastTickCpuBudgetGranted);
	writer.i64(state.lastTickCpuUsedCycles);
	writer.i64(state.lastTickBudgetRemaining);
	writer.bool(state.lastTickVisualFrameCommitted);
	writer.bool(state.lastTickCompleted);
	writer.i64(state.lastTickConsumedSequence);
}

function readFrameSchedulerStateSnapshot(reader: BinaryReader): FrameSchedulerStateSnapshot {
	return {
		accumulatedHostTimeMs: reader.f64(),
		cycleGrantRemainder: reader.f64(),
		carriedCycleBudget: reader.i64(),
		tickCompletionPending: reader.bool(),
		tickCompletionVisualCommitted: reader.bool(),
		logicalTickRunPending: reader.bool(),
		logicalTickRunTargetSequence: reader.i64(),
		lastTickSequence: reader.i64(),
		lastTickBudgetGranted: reader.i64(),
		lastTickCpuBudgetGranted: reader.i64(),
		lastTickCpuUsedCycles: reader.i64(),
		lastTickBudgetRemaining: reader.i64(),
		lastTickVisualFrameCommitted: reader.bool(),
		lastTickCompleted: reader.bool(),
		lastTickConsumedSequence: reader.i64(),
	};
}

function writeFrameState(writer: BinarySink, state: FrameState): void {
	writer.bool(state.updateExecuted);
	writer.i64(state.cycleBudgetRemaining);
	writer.i64(state.cycleBudgetGranted);
	writer.i64(state.cycleCarryGranted);
	writer.i64(state.activeCpuUsedCycles);
	writer.i32(state.deferredAllocationCycles);
}

function readFrameState(reader: BinaryReader): FrameState {
	return {
		updateExecuted: reader.bool(),
		cycleBudgetRemaining: reader.i64(),
		cycleBudgetGranted: reader.i64(),
		cycleCarryGranted: reader.i64(),
		activeCpuUsedCycles: reader.i64(),
		deferredAllocationCycles: reader.i32(),
	};
}

function writeFrameLoopStateSnapshot(writer: BinarySink, state: FrameLoopStateSnapshot): void {
	writeFrameState(writer, state.frameState);
	writer.bool(state.frameActive);
}

function readFrameLoopStateSnapshot(reader: BinaryReader): FrameLoopStateSnapshot {
	return {
		frameState: readFrameState(reader),
		frameActive: reader.bool(),
	};
}

function writeCartridgeMailboxState(writer: BinarySink, state: CartridgeMailboxState): void {
	writer.u32(state.dataWord);
	writer.u32(state.controlWord);
	writer.bool(state.irqPending);
}

function readCartridgeMailboxState(reader: BinaryReader): CartridgeMailboxState {
	return {
		dataWord: reader.u32(),
		controlWord: reader.u32(),
		irqPending: reader.bool(),
	};
}

function writeCartridgeCardState(writer: BinarySink, state: CartridgeCardState): void {
	writer.bool(state.ram !== null);
	if (state.ram !== null) {
		writer.u32(state.ram.length);
		writer.bytes(state.ram);
	}
	writer.bool(state.mailbox !== null);
	if (state.mailbox !== null) {
		writeCartridgeMailboxState(writer, state.mailbox);
	}
}

function readCartridgeCardState(reader: BinaryReader): CartridgeCardState {
	return {
		ram: reader.bool() ? reader.bytes(reader.u32()) : null,
		mailbox: reader.bool() ? readCartridgeMailboxState(reader) : null,
	};
}

function writeCartridgeControllerState(writer: BinarySink, state: CartridgeControllerState): void {
	writer.u32(state.selectionWord);
	for (const value of state.slots) {
		writer.bool(value !== null);
		if (value !== null) {
			writeCartridgeCardState(writer, value);
		}
	}
}

function readCartridgeControllerState(reader: BinaryReader): CartridgeControllerState {
	return {
		selectionWord: reader.u32(),
		slots: [
		reader.bool() ? readCartridgeCardState(reader) : null,
		reader.bool() ? readCartridgeCardState(reader) : null,
	],
	};
}

function writeMemoryBusState(writer: BinarySink, state: MemoryBusState): void {
	writer.u32(state.ramBusEnd);
	writer.u32(state.busFaultCode);
	writer.u32(state.busFaultAddr);
	writer.u32(state.busFaultAccess);
}

function readMemoryBusState(reader: BinaryReader): MemoryBusState {
	return {
		ramBusEnd: reader.u32(),
		busFaultCode: reader.u32(),
		busFaultAddr: reader.u32(),
		busFaultAccess: reader.u32(),
	};
}

function writeIrqControllerState(writer: BinarySink, state: IrqControllerState): void {
	writer.u32(state.mask);
	writer.u32(state.pendingFlags);
	writer.u32(state.userMask);
	writer.u32(state.userPendingFlags);
	writer.bool(state.supervisorContextActive);
}

function readIrqControllerState(reader: BinaryReader): IrqControllerState {
	return {
		mask: reader.u32(),
		pendingFlags: reader.u32(),
		userMask: reader.u32(),
		userPendingFlags: reader.u32(),
		supervisorContextActive: reader.bool(),
	};
}

function writeInputControllerState(writer: BinarySink, state: InputControllerState): void {
	writer.bool(state.sampleArmed);
	writer.u32(state.sampleSequence);
	writer.u32(state.lastSampleCycle);
	writer.bool(state.supervisorRequestLineHigh);
	writeInputControllerRegisterState(writer, state.registers);
}

function readInputControllerState(reader: BinaryReader): InputControllerState {
	return {
		sampleArmed: reader.bool(),
		sampleSequence: reader.u32(),
		lastSampleCycle: reader.u32(),
		supervisorRequestLineHigh: reader.bool(),
		registers: readInputControllerRegisterState(reader),
	};
}

function writeGeometryJobState(writer: BinarySink, state: GeometryJobState): void {
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

function readGeometryJobState(reader: BinaryReader): GeometryJobState {
	return {
		cmd: reader.u32(),
		src0: reader.u32(),
		src1: reader.u32(),
		src2: reader.u32(),
		dst0: reader.u32(),
		dst1: reader.u32(),
		count: reader.u32(),
		param0: reader.u32(),
		param1: reader.u32(),
		stride0: reader.u32(),
		stride1: reader.u32(),
		stride2: reader.u32(),
		processed: reader.u32(),
		resultCount: reader.u32(),
		exactPairCount: reader.u32(),
		broadphasePairCount: reader.u32(),
	};
}

function writeGeometryOverlapProgress(writer: BinarySink, state: GeometryOverlap2dProgress): void {
	writer.u32(state.phase); writer.u32(state.instanceBIndex); writer.u32(state.pairMeta);
	writer.u32(state.shapeAAddr); writer.u32(state.shapeBAddr);
	writer.u32(state.shapeAOffset); writer.u32(state.shapeBOffset);
	writer.u32(state.countA); writer.u32(state.countB); writer.u32(state.pieceA); writer.u32(state.pieceB);
	writer.bool(state.compoundA); writer.bool(state.compoundB); writer.bool(state.bestHit);
	writer.u32(state.bestPieceA); writer.u32(state.bestPieceB); writer.u32(state.bestFeature);
	writer.f64(state.bestDepth); writer.f64(state.bestNx); writer.f64(state.bestNy);
	writer.f64(state.bestPx); writer.f64(state.bestPy);
	writer.u32s(state.instanceA); writer.u32s(state.instanceB);
	for (const value of state.boundsA) writer.f64(value);
	writer.u32(state.pendingWork.axes); writer.u32(state.pendingWork.projectionVertices);
	writer.u32(state.pendingWork.averageVertices); writer.u32(state.pendingWork.clipVertices);
	writer.u32(state.pendingWork.clipEdges); writer.u32(state.pendingWork.squareRoots);
	writer.u32(state.pendingWork.divisions);
	writer.u32(state.pendingWriteFlags); writer.u32(state.afterPublishPhase);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingFault);
}

function readGeometryOverlapProgress(reader: BinaryReader): GeometryOverlap2dProgress {
	return {
		phase: reader.u32() as GeometryOverlap2dPhase,
		instanceBIndex: reader.u32(), pairMeta: reader.u32(),
		shapeAAddr: reader.u32(), shapeBAddr: reader.u32(),
		shapeAOffset: reader.u32(), shapeBOffset: reader.u32(),
		countA: reader.u32(), countB: reader.u32(), pieceA: reader.u32(), pieceB: reader.u32(),
		compoundA: reader.bool(), compoundB: reader.bool(), bestHit: reader.bool(),
		bestPieceA: reader.u32(), bestPieceB: reader.u32(), bestFeature: reader.u32(),
		bestDepth: reader.f64(), bestNx: reader.f64(), bestNy: reader.f64(),
		bestPx: reader.f64(), bestPy: reader.f64(),
		instanceA: reader.u32Array(GEO_OVERLAP2D_INSTANCE_WORDS),
		instanceB: reader.u32Array(GEO_OVERLAP2D_INSTANCE_WORDS),
		boundsA: Float64Array.of(reader.f64(), reader.f64(), reader.f64(), reader.f64()),
		pendingWork: {
			axes: reader.u32(), projectionVertices: reader.u32(),
			averageVertices: reader.u32(), clipVertices: reader.u32(),
			clipEdges: reader.u32(), squareRoots: reader.u32(), divisions: reader.u32(),
		},
		pendingWriteFlags: reader.u32(), afterPublishPhase: reader.u32() as GeometryOverlap2dPhase,
		pendingMemory: { ramWords: reader.u32(), systemRomWords: reader.u32(), cartridgeWords: reader.u32(), otherWords: reader.u32() },
		pendingFault: reader.u32(),
	};
}

function writeGeometryXformProgress(writer: BinarySink, state: GeometryXform2Progress): void {
	writer.u32(state.phase);
	writer.u32(state.dstAddress); writer.u32(state.boundsAddress);
	writer.u32(state.vertexCount); writer.bool(state.hasBounds);
	writer.u32s(state.vertices); writer.u32s(state.bounds);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingWorkUnits); writer.u32(state.pendingFault);
}

function readGeometryXformProgress(reader: BinaryReader): GeometryXform2Progress {
	return {
		phase: reader.u32() as GeometryXform2Phase,
		dstAddress: reader.u32(), boundsAddress: reader.u32(),
		vertexCount: reader.u32(), hasBounds: reader.bool(),
		vertices: reader.u32Array(GEO_XFORM2_MAX_VERTICES * GEO_VERTEX2_BYTES / IO_WORD_SIZE),
		bounds: reader.u32Array(GEO_XFORM2_AABB_BYTES / IO_WORD_SIZE),
		pendingMemory: { ramWords: reader.u32(), systemRomWords: reader.u32(), cartridgeWords: reader.u32(), otherWords: reader.u32() },
		pendingWorkUnits: reader.u32(), pendingFault: reader.u32(),
	};
}

function writeGeometrySatProgress(writer: BinarySink, state: GeometrySat2Progress): void {
	writer.u32(state.phase);
	writer.u32(state.vertexAddressA); writer.u32(state.vertexAddressB);
	writer.u32(state.countA); writer.u32(state.countB); writer.u32(state.resultAddress);
	writer.u32s(state.verticesA); writer.u32s(state.verticesB); writer.u32s(state.result);
	writer.u32(state.pendingMemory.ramWords); writer.u32(state.pendingMemory.systemRomWords);
	writer.u32(state.pendingMemory.cartridgeWords); writer.u32(state.pendingMemory.otherWords);
	writer.u32(state.pendingWorkUnits); writer.u32(state.pendingFault);
}

function readGeometrySatProgress(reader: BinaryReader): GeometrySat2Progress {
	return {
		phase: reader.u32() as GeometrySat2Phase,
		vertexAddressA: reader.u32(), vertexAddressB: reader.u32(),
		countA: reader.u32(), countB: reader.u32(), resultAddress: reader.u32(),
		verticesA: reader.u32Array(GEO_SAT2_MAX_POLY_VERTICES * GEO_VERTEX2_BYTES / IO_WORD_SIZE),
		verticesB: reader.u32Array(GEO_SAT2_MAX_POLY_VERTICES * GEO_VERTEX2_BYTES / IO_WORD_SIZE),
		result: reader.u32Array(GEO_SAT2_RESULT_BYTES / IO_WORD_SIZE),
		pendingMemory: { ramWords: reader.u32(), systemRomWords: reader.u32(), cartridgeWords: reader.u32(), otherWords: reader.u32() },
		pendingWorkUnits: reader.u32(), pendingFault: reader.u32(),
	};
}

function writeGeometryControllerState(writer: BinarySink, state: GeometryControllerState): void {
	writer.u32(state.phase);
	writer.u32s(state.registerWords);
	writer.bool(state.activeJob !== null);
	if (state.activeJob !== null) {
		writeGeometryJobState(writer, state.activeJob);
	}
	writeGeometryXformProgress(writer, state.xform);
	writeGeometrySatProgress(writer, state.sat);
	writeGeometryOverlapProgress(writer, state.overlap);
	writer.i64(state.workCarry);
	writer.i64(state.pendingCycles);
	writer.bool(state.supervisorQuiesceRequested);
}

function readGeometryControllerState(reader: BinaryReader): GeometryControllerState {
	return {
		phase: reader.u32() as GeometryControllerPhase,
		registerWords: reader.u32s(GEOMETRY_CONTROLLER_REGISTER_COUNT),
		activeJob: reader.bool() ? readGeometryJobState(reader) : null,
		xform: readGeometryXformProgress(reader),
		sat: readGeometrySatProgress(reader),
		overlap: readGeometryOverlapProgress(reader),
		workCarry: reader.i64(),
		pendingCycles: reader.i64(),
		supervisorQuiesceRequested: reader.bool(),
	};
}

function writeGxGpuCommandBufferState(writer: BinarySink, state: GxGpuCommandBufferState): void {
	writer.u64(state.commandCount);
	writer.u64(state.executedCommandCount);
	writer.u64(state.presentCommandCount);
	writer.u64(state.wordCount);
	writer.u32(state.commandKind.length);
	writer.u8s(state.commandKind);
	writer.u32(state.commandOpcode.length);
	writer.u8s(state.commandOpcode);
	writer.u32(state.commandWordStart.length);
	writer.u32s(state.commandWordStart);
	writer.u32(state.commandWordCount.length);
	writer.u32s(state.commandWordCount);
	writer.u32(state.commandDrawModeWord.length);
	writer.u32s(state.commandDrawModeWord);
	writer.u32(state.commandVramYAddressExtensionWord.length);
	writer.u32s(state.commandVramYAddressExtensionWord);
	writer.u32(state.commandTextureWindowWord.length);
	writer.u32s(state.commandTextureWindowWord);
	writer.u32(state.commandDrawingAreaTopLeftWord.length);
	writer.u32s(state.commandDrawingAreaTopLeftWord);
	writer.u32(state.commandDrawingAreaBottomRightWord.length);
	writer.u32s(state.commandDrawingAreaBottomRightWord);
	writer.u32(state.commandDrawingOffsetWord.length);
	writer.u32s(state.commandDrawingOffsetWord);
	writer.u32(state.commandMaskBitModeWord.length);
	writer.u32s(state.commandMaskBitModeWord);
	writer.u32(state.commandSkippedLineParity.length);
	writer.u8s(state.commandSkippedLineParity);
	writer.u32(state.words.length);
	writer.u32s(state.words);
	writer.u8(state.readbackPhase);
	writer.u64(state.readbackFenceCommandCount);
	writer.u32(state.readbackX);
	writer.u32(state.readbackY);
	writer.u32(state.readbackVramYAddressExtensionWord);
	writer.u32(state.readbackWidth);
	writer.u32(state.readbackHeight);
	writer.u32(state.readbackPixelCursor);
	writer.u32(state.readbackPixelBytes.length);
	writer.bytes(state.readbackPixelBytes);
}

function readGxGpuCommandBufferState(reader: BinaryReader): GxGpuCommandBufferState {
	return {
		commandCount: reader.u64(),
		executedCommandCount: reader.u64(),
		presentCommandCount: reader.u64(),
		wordCount: reader.u64(),
		commandKind: reader.u8s(reader.u32()),
		commandOpcode: reader.u8s(reader.u32()),
		commandWordStart: reader.u32s(reader.u32()),
		commandWordCount: reader.u32s(reader.u32()),
		commandDrawModeWord: reader.u32s(reader.u32()),
		commandVramYAddressExtensionWord: reader.u32s(reader.u32()),
		commandTextureWindowWord: reader.u32s(reader.u32()),
		commandDrawingAreaTopLeftWord: reader.u32s(reader.u32()),
		commandDrawingAreaBottomRightWord: reader.u32s(reader.u32()),
		commandDrawingOffsetWord: reader.u32s(reader.u32()),
		commandMaskBitModeWord: reader.u32s(reader.u32()),
		commandSkippedLineParity: reader.u8s(reader.u32()),
		words: reader.u32s(reader.u32()),
		readbackPhase: reader.u8(),
		readbackFenceCommandCount: reader.u64(),
		readbackX: reader.u32(),
		readbackY: reader.u32(),
		readbackVramYAddressExtensionWord: reader.u32(),
		readbackWidth: reader.u32(),
		readbackHeight: reader.u32(),
		readbackPixelCursor: reader.u32(),
		readbackPixelBytes: reader.bytes(reader.u32()),
	};
}

function writeGxGpuRegisterContextState(writer: BinarySink, state: GxGpuRegisterContextState): void {
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
	writer.bool(state.vramPresentationPending);
}

function readGxGpuRegisterContextState(reader: BinaryReader): GxGpuRegisterContextState {
	return {
		gp0Word: reader.u32(),
		gp1Word: reader.u32(),
		displayModeWord: reader.u32(),
		statusWord: reader.u32(),
		gpuReadWord: reader.u32(),
		drawModeWord: reader.u32(),
		textureWindowWord: reader.u32(),
		drawingAreaTopLeftWord: reader.u32(),
		drawingAreaBottomRightWord: reader.u32(),
		drawingOffsetWord: reader.u32(),
		maskBitModeWord: reader.u32(),
		displayStartWord: reader.u32(),
		horizontalDisplayRangeWord: reader.u32(),
		verticalDisplayRangeWord: reader.u32(),
		vramYAddressExtensionWord: reader.u32(),
		presentStatusWord: reader.u32(),
		presentDisplayModeWord: reader.u32(),
		presentDisplayStartWord: reader.u32(),
		presentVramYAddressExtensionWord: reader.u32(),
		presentHorizontalDisplayRangeWord: reader.u32(),
		presentVerticalDisplayRangeWord: reader.u32(),
		pcrtcRegisterWords: reader.u32s(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT),
		pcrtcPresentWords: reader.u32s(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT),
		vramPresentationPending: reader.bool(),
	};
}

function writeGxGpuIngressContextState(writer: BinarySink, state: GxGpuIngressContextState): void {
	writer.u32(state.gp0CommandTargetWordCount);
	writer.u32(state.gp0CommandWords.length);
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
	writer.u32(state.commandBufferWords.length);
	writer.u32s(state.commandBufferWords);
	writer.u8(state.readbackPhase);
	writer.u64(state.readbackFenceCommandCount);
	writer.u32(state.readbackX);
	writer.u32(state.readbackY);
	writer.u32(state.readbackVramYAddressExtensionWord);
	writer.u32(state.readbackWidth);
	writer.u32(state.readbackHeight);
	writer.u32(state.readbackPixelCursor);
	writer.u32(state.readbackPixelBytes.length);
	writer.bytes(state.readbackPixelBytes);
	writer.u32(state.gp0FifoWords.length);
	writer.u32s(state.gp0FifoWords);
	writer.u32(state.gp0DmaIngressWords.length);
	writer.u32s(state.gp0DmaIngressWords);
}

function readGxGpuIngressContextState(reader: BinaryReader): GxGpuIngressContextState {
	return {
		gp0CommandTargetWordCount: reader.u32(),
		gp0CommandWords: reader.u32s(reader.u32()),
		gp0IngressPhase: reader.u32(),
		gp0IngressWordsRemaining: reader.u32(),
		gp0IngressPolylineWordsPerVertex: reader.u32(),
		gp0IngressPolylinePayloadPhase: reader.u32(),
		gp0ImageLoadWordsRemaining: reader.u32(),
		gp0ImageLoadCommandWordStart: reader.u64(),
		gp0ImageLoadCommandWordCount: reader.u32(),
		gp0ImageLoadCommandOpcode: reader.u8(),
		gp0PolylinePayloadPhase: reader.u32(),
		gp0PolylineOpcode: reader.u8(),
		gp0PolylineColorWord: reader.u32(),
		gp0PolylinePositionWord: reader.u32(),
		gp0PolylineNextColorWord: reader.u32(),
		commandBufferWords: reader.u32s(reader.u32()),
		readbackPhase: reader.u8(),
		readbackFenceCommandCount: reader.u64(),
		readbackX: reader.u32(),
		readbackY: reader.u32(),
		readbackVramYAddressExtensionWord: reader.u32(),
		readbackWidth: reader.u32(),
		readbackHeight: reader.u32(),
		readbackPixelCursor: reader.u32(),
		readbackPixelBytes: reader.bytes(reader.u32()),
		gp0FifoWords: reader.u32s(reader.u32()),
		gp0DmaIngressWords: reader.u32s(reader.u32()),
	};
}

function writeGxGpuPcrtcState(writer: BinarySink, state: GxGpuPcrtcState): void {
	writer.u32s(state.registerWords);
	writer.u32s(state.presentWords);
	writer.u32(state.csrWord);
	writer.u32(state.imrWord);
	writer.i64(state.beamCycleOffset);
	writer.u32(state.beamRemainder);
	writer.u32(state.beamHalfLine);
	writer.u32(state.nextHsyncHalfLine);
	writer.u32(state.verticalStage);
	writer.bool(state.vblankActive);
}

function readGxGpuPcrtcState(reader: BinaryReader): GxGpuPcrtcState {
	return {
		registerWords: reader.u32s(GX_GPU_PCRTC_CONFIG_WORD_COUNT),
		presentWords: reader.u32s(GX_GPU_PCRTC_CONFIG_WORD_COUNT),
		csrWord: reader.u32(),
		imrWord: reader.u32(),
		beamCycleOffset: reader.i64(),
		beamRemainder: reader.u32(),
		beamHalfLine: reader.u32(),
		nextHsyncHalfLine: reader.u32(),
		verticalStage: reader.u32(),
		vblankActive: reader.bool(),
	};
}

function writeGxGpuState(writer: BinarySink, state: GxGpuState): void {
	writer.u32(state.gp0Word);
	writer.u32(state.gp1Word);
	writer.u32(state.displayModeWord);
	writer.u32(state.statusWord);
	writer.u32(state.gp0CommandWordCount);
	writer.u32(state.gp0CommandTargetWordCount);
	writer.u32(state.gp0CommandWords.length);
	writer.u32s(state.gp0CommandWords);
	writer.u32(state.gp0FifoWords.length);
	writer.u32s(state.gp0FifoWords);
	writer.u32(state.gp0DmaIngressWords.length);
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
	writer.bool(state.pcrtcPresentationPending);
	writer.bool(state.vramPresentationPending);
	writer.bool(state.supervisorQuiesceRequested);
	writer.bool(state.supervisorIngressQuiesceRequested);
	writer.bool(state.supervisorIngressStopped);
	writeGxGpuRegisterContextState(writer, state.userContext);
	writeGxGpuIngressContextState(writer, state.userIngressContext);
	writeGxGpuCommandBufferState(writer, state.commandBuffer);
}

function writeGxGpuSaveState(writer: BinarySink, state: GxGpuSaveState): void {
	writeGxGpuState(writer, state);
	writer.bytes(state.vramBytes);
}

function readGxGpuSaveState(reader: BinaryReader, gxGpuVramByteCount: number): GxGpuSaveState {
	return {
		gp0Word: reader.u32(),
		gp1Word: reader.u32(),
		displayModeWord: reader.u32(),
		statusWord: reader.u32(),
		gp0CommandWordCount: reader.u32(),
		gp0CommandTargetWordCount: reader.u32(),
		gp0CommandWords: reader.u32s(reader.u32()),
		gp0FifoWords: reader.u32s(reader.u32()),
		gp0DmaIngressWords: reader.u32s(reader.u32()),
		gp0IngressPhase: reader.u32(),
		gp0IngressWordsRemaining: reader.u32(),
		gp0IngressPolylineWordsPerVertex: reader.u32(),
		gp0IngressPolylinePayloadPhase: reader.u32(),
		pendingCommandCycles: reader.i64(),
		pendingCommandTargetCount: reader.u64(),
		gp0ImageLoadWordsRemaining: reader.u32(),
		gp0ImageLoadCommandWordStart: reader.u64(),
		gp0ImageLoadCommandWordCount: reader.u32(),
		gp0ImageLoadCommandOpcode: reader.u8(),
		gp0PolylinePayloadPhase: reader.u32(),
		gp0PolylineOpcode: reader.u8(),
		gp0PolylineColorWord: reader.u32(),
		gp0PolylinePositionWord: reader.u32(),
		gp0PolylineNextColorWord: reader.u32(),
		gpuReadWord: reader.u32(),
		drawModeWord: reader.u32(),
		textureWindowWord: reader.u32(),
		drawingAreaTopLeftWord: reader.u32(),
		drawingAreaBottomRightWord: reader.u32(),
		drawingOffsetWord: reader.u32(),
		maskBitModeWord: reader.u32(),
		displayStartWord: reader.u32(),
		horizontalDisplayRangeWord: reader.u32(),
		verticalDisplayRangeWord: reader.u32(),
		vramYAddressExtensionWord: reader.u32(),
		presentStatusWord: reader.u32(),
		presentDisplayModeWord: reader.u32(),
		presentDisplayStartWord: reader.u32(),
		presentVramYAddressExtensionWord: reader.u32(),
		presentHorizontalDisplayRangeWord: reader.u32(),
		presentVerticalDisplayRangeWord: reader.u32(),
		pcrtc: readGxGpuPcrtcState(reader),
		pcrtcPresentationPending: reader.bool(),
		vramPresentationPending: reader.bool(),
		supervisorQuiesceRequested: reader.bool(),
		supervisorIngressQuiesceRequested: reader.bool(),
		supervisorIngressStopped: reader.bool(),
		userContext: readGxGpuRegisterContextState(reader),
		userIngressContext: readGxGpuIngressContextState(reader),
		commandBuffer: readGxGpuCommandBufferState(reader),
		vramBytes: reader.bytes(gxGpuVramByteCount),
	};
}

function writeGxGteState(writer: BinarySink, state: GxGteState): void {
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
	writer.bool(state.plusInterlockArmed);
	writer.u32(state.plusPendingResultXy);
	writer.u32(state.plusPendingResultZ);
	writer.u32(state.plusPendingFlag);
}

function readGxGteState(reader: BinaryReader): GxGteState {
	return {
		dataRegisterWords: reader.u32s(GX_GTE_DATA_REGISTER_COUNT),
		controlRegisterWords: reader.u32s(GX_GTE_CONTROL_REGISTER_COUNT),
		plusRegisterWords: reader.u32s(GX_GTE_PLUS_REGISTER_COUNT),
		mac0: reader.i64(),
		mac1: reader.i64(),
		mac2: reader.i64(),
		mac3: reader.i64(),
		currentSf: reader.u32(),
		lastCycles: reader.u32(),
		normalPendingCycles: reader.u32(),
		plusPendingCycles: reader.u32(),
		plusInterlockArmed: reader.bool(),
		plusPendingResultXy: reader.u32(),
		plusPendingResultZ: reader.u32(),
		plusPendingFlag: reader.u32(),
	};
}

function writeApuBiquadFilterState(writer: BinarySink, state: ApuBiquadFilterState): void {
	writer.i32(state.l1);
	writer.i32(state.l2);
	writer.i32(state.r1);
	writer.i32(state.r2);
}

function readApuBiquadFilterState(reader: BinaryReader): ApuBiquadFilterState {
	return {
		l1: reader.i32(),
		l2: reader.i32(),
		r1: reader.i32(),
		r2: reader.i32(),
	};
}

function writeApuBadpDecoderSaveState(writer: BinarySink, state: ApuBadpDecoderSaveState): void {
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

function readApuBadpDecoderSaveState(reader: BinaryReader): ApuBadpDecoderSaveState {
	return {
		predictors: reader.i32s(2),
		stepIndices: reader.i32s(2),
		nextFrame: reader.u32(),
		blockEnd: reader.u32(),
		blockFrames: reader.u32(),
		blockFrameIndex: reader.u32(),
		payloadOffset: reader.u32(),
		nibbleCursor: reader.u32(),
		decodedFrame: reader.i64(),
		decodedLeft: reader.i16(),
		decodedRight: reader.i16(),
		previousDecodedFrame: reader.i64(),
		previousDecodedLeft: reader.i16(),
		previousDecodedRight: reader.i16(),
	};
}

function writeApuOutputVoiceState(writer: BinarySink, state: ApuOutputVoiceState): void {
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

function readApuOutputVoiceState(reader: BinaryReader): ApuOutputVoiceState {
	return {
		slot: reader.u32(),
		sourceCartridgeSlot: reader.u32(),
		cursorQ16: reader.i64(),
		phaseRemainder: reader.i32(),
		gainQ12: reader.i32(),
		fadeStepQ12: reader.i32(),
		fadeStepRemainder: reader.i32(),
		fadeError: reader.u32(),
		fadeSamplesRemaining: reader.u32(),
		fadeSamplesTotal: reader.u32(),
		filter: readApuBiquadFilterState(reader),
		badp: readApuBadpDecoderSaveState(reader),
	};
}

function writeApuCommandFifoState(writer: BinarySink, state: ApuCommandFifoState): void {
	writer.u32s(state.commands);
	writer.u32s(state.registerWords);
	writer.u32(state.readIndex);
	writer.u32(state.writeIndex);
	writer.u32(state.count);
}

function readApuCommandFifoState(reader: BinaryReader): ApuCommandFifoState {
	return {
		commands: reader.u32s(APU_COMMAND_FIFO_CAPACITY),
		registerWords: reader.u32s(APU_COMMAND_FIFO_REGISTER_WORD_COUNT),
		readIndex: reader.u32(),
		writeIndex: reader.u32(),
		count: reader.u32(),
	};
}

function writeApuSampleTransferState(writer: BinarySink, state: ApuSampleTransferState): void {
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

function readApuSampleTransferState(reader: BinaryReader): ApuSampleTransferState {
	return {
		fifoWords: reader.u32s(APU_TRANSFER_FIFO_WORD_CAPACITY),
		fifoReadIndex: reader.u32(),
		fifoWriteIndex: reader.u32(),
		fifoCount: reader.u32(),
		transferAddressWord: reader.u32(),
		transferDataWord: reader.u32(),
		transferControlWord: reader.u32(),
		currentAddress: reader.u32(),
		timingCarry: reader.i64(),
		scheduledWords: reader.u32(),
		scheduledCycles: reader.i64(),
	};
}

function writeAudioControllerState(writer: BinarySink, state: AudioControllerState): void {
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

function readAudioControllerState(reader: BinaryReader): AudioControllerState {
	return {
		registerWords: reader.u32s(APU_PARAMETER_REGISTER_COUNT),
		commandFifo: readApuCommandFifoState(reader),
		eventSequence: reader.u32(),
		eventKind: reader.u32(),
		eventSlot: reader.u32(),
		eventSourceAddr: reader.u32(),
		slotPhases: reader.u32s(APU_SLOT_COUNT),
		slotRegisterWords: reader.u32s(APU_SLOT_REGISTER_WORD_COUNT),
		sampleRam: reader.bytes(APU_SAMPLE_RAM_BYTES),
		sampleTransfer: readApuSampleTransferState(reader),
		output: readApuOutputState(reader),
		sampleCarry: reader.i64(),
		sampleSequence: reader.i64(),
		apuStatus: reader.u32(),
		apuFaultCode: reader.u32(),
		apuFaultDetail: reader.u32(),
	};
}

function writeDmaChannelState(writer: BinarySink, state: DmaChannelState): void {
	writer.u32(state.readAddressWord);
	writer.u32(state.writeAddressWord);
	writer.u32(state.transferCountWord);
	writer.u32(state.controlWord);
	writer.u32(state.statusWord);
}

function readDmaChannelState(reader: BinaryReader): DmaChannelState {
	return {
		readAddressWord: reader.u32(),
		writeAddressWord: reader.u32(),
		transferCountWord: reader.u32(),
		controlWord: reader.u32(),
		statusWord: reader.u32(),
	};
}

function writeDmaControllerState(writer: BinarySink, state: DmaControllerState): void {
	for (const value of state.channels) {
		writeDmaChannelState(writer, value);
	}
	writer.u32(state.activeChannel);
	writer.u32(state.nextChannel);
	writer.u32(state.scheduledBlockWords);
	writer.i64(state.scheduledBlockCycles);
	writer.bool(state.supervisorQuiesceRequested);
	writer.bool(state.supervisorAdmissionQuiesceRequested);
	for (const value of state.userChannels) {
		writeDmaChannelState(writer, value);
	}
	writer.u32(state.userNextChannel);
}

function readDmaControllerState(reader: BinaryReader): DmaControllerState {
	return {
		channels: [readDmaChannelState(reader), readDmaChannelState(reader)],
		activeChannel: reader.u32(),
		nextChannel: reader.u32(),
		scheduledBlockWords: reader.u32(),
		scheduledBlockCycles: reader.i64(),
		supervisorQuiesceRequested: reader.bool(),
		supervisorAdmissionQuiesceRequested: reader.bool(),
		userChannels: [readDmaChannelState(reader), readDmaChannelState(reader)],
		userNextChannel: reader.u32(),
	};
}

function writeImgDecControllerState(writer: BinarySink, state: ImgDecControllerState): void {
	writer.u32(state.inputWordCountWord);
	writer.u32(state.outputWordCountWord);
	writer.u32(state.controlWord);
	writer.u32(state.statusWord);
	writer.u32(state.dataWord);
	writer.u32(state.inputWordsReceived);
	writer.u32(state.assembledWordCount);
	writer.u32(state.decodedWordCount);
	writer.u32(state.outputWordsRead);
	writer.u32(state.decodePhase);
	writer.u32(state.runWordsRemaining);
	writer.u32(state.repeatWord);
	writer.u32(state.backReferenceDistance);
	writer.u32(state.blockPhase);
	writer.i64(state.blockCyclesRemaining);
	writer.bool(state.supervisorQuiesceRequested);
	writer.u32(state.inputWords.length);
	writer.u32s(state.inputWords);
	writer.u32(state.historyWords.length);
	writer.u32s(state.historyWords);
}

function readImgDecControllerState(reader: BinaryReader): ImgDecControllerState {
	return {
		inputWordCountWord: reader.u32(),
		outputWordCountWord: reader.u32(),
		controlWord: reader.u32(),
		statusWord: reader.u32(),
		dataWord: reader.u32(),
		inputWordsReceived: reader.u32(),
		assembledWordCount: reader.u32(),
		decodedWordCount: reader.u32(),
		outputWordsRead: reader.u32(),
		decodePhase: reader.u32(),
		runWordsRemaining: reader.u32(),
		repeatWord: reader.u32(),
		backReferenceDistance: reader.u32(),
		blockPhase: reader.u32(),
		blockCyclesRemaining: reader.i64(),
		supervisorQuiesceRequested: reader.bool(),
		inputWords: reader.u32s(reader.u32()),
		historyWords: reader.u32s(reader.u32()),
	};
}

function writeSystemControllerState(writer: BinarySink, state: SystemControllerState): void {
	writer.bool(state.resetRequested);
	writer.u8(state.supervisorPhase);
	writer.u8(state.supervisorTransitionTarget);
	writer.bool(state.supervisorResumable);
	writer.bool(state.supervisorExitRequested);
	writer.u32(state.supervisorFaultSequenceWord);
	writer.u32(state.supervisorFaultCauseWord);
	writer.u32(state.supervisorFaultEpcWord);
	writer.u32(state.supervisorFaultBadAddressWord);
	writer.u32(state.supervisorFaultLuaReasonWord);
	writer.u32(state.supervisorFaultDomainWord);
}

function readSystemControllerState(reader: BinaryReader): SystemControllerState {
	return {
		resetRequested: reader.bool(),
		supervisorPhase: reader.u8(),
		supervisorTransitionTarget: reader.u8(),
		supervisorResumable: reader.bool(),
		supervisorExitRequested: reader.bool(),
		supervisorFaultSequenceWord: reader.u32(),
		supervisorFaultCauseWord: reader.u32(),
		supervisorFaultEpcWord: reader.u32(),
		supervisorFaultBadAddressWord: reader.u32(),
		supervisorFaultLuaReasonWord: reader.u32(),
		supervisorFaultDomainWord: reader.u32(),
	};
}

function writeSystemDebugTransmitState(writer: BinarySink, state: SystemDebugTransmitState): void {
	writer.u32(state.charWord);
	writer.u32(state.flushWord);
}

function readSystemDebugTransmitState(reader: BinaryReader): SystemDebugTransmitState {
	return {
		charWord: reader.u32(),
		flushWord: reader.u32(),
	};
}

function writeMachineSaveState(writer: BinarySink, state: MachineSaveState): void {
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

function readMachineSaveState(reader: BinaryReader, gxGpuVramByteCount: number): MachineSaveState {
	return {
		memory: readMemoryBusState(reader),
		cartridge: readCartridgeControllerState(reader),
		dma: readDmaControllerState(reader),
		geometry: readGeometryControllerState(reader),
		gxGpu: readGxGpuSaveState(reader, gxGpuVramByteCount),
		gxGte: readGxGteState(reader),
		irq: readIrqControllerState(reader),
		audio: readAudioControllerState(reader),
		input: readInputControllerState(reader),
		imgDec: readImgDecControllerState(reader),
		systemDebugTransmit: readSystemDebugTransmitState(reader),
		systemControl: readSystemControllerState(reader),
	};
}

function writeRuntimeSaveMachineState(writer: BinarySink, state: RuntimeSaveMachineState): void {
	writeMachineSaveState(writer, state.machine);
	writeFrameSchedulerStateSnapshot(writer, state.frameScheduler);
	writeFrameLoopStateSnapshot(writer, state.frameLoop);
	writer.i64(state.schedulerNowCycles);
	writer.i64(state.acceptedCpuCycles);
}

function readRuntimeSaveMachineState(reader: BinaryReader, gxGpuVramByteCount: number): RuntimeSaveMachineState {
	return {
		machine: readMachineSaveState(reader, gxGpuVramByteCount),
		frameScheduler: readFrameSchedulerStateSnapshot(reader),
		frameLoop: readFrameLoopStateSnapshot(reader),
		schedulerNowCycles: reader.i64(),
		acceptedCpuCycles: reader.i64(),
	};
}

function writeCpuRuntimeState(writer: BinarySink, state: CpuRuntimeState): void {
	writer.i32(state.executionCartridgeSlot);
	writer.i32(state.programExecutionDomainId);
	writer.u32(state.rootThreadAddress);
	writer.u32(state.activeThreadAddress);
	writer.u32(state.completionThreadAddress);
	writer.u32(state.completionValues.length);
	for (const value of state.completionValues) writer.u64(value);
	writer.i32(state.lastExecutionDomainId);
	writer.u32(state.executionResidencyMask);
	writer.bool(state.hardHalted);
	writer.u32(state.lastPc);
	writer.u32(state.haltedUntilIrqThreadAddress);
	writer.i32(state.haltedUntilIrqFrameDepth);
	writer.bool(state.interruptEventPending);
	writer.bool(state.memoryWriteBlocked);
	writer.u32(state.memoryWriteBlockedAddress);
	writer.u32(state.pendingMemory.kind);
	writer.u32(state.pendingMemory.instructionPc);
	writer.u32(state.pendingMemory.nextPc);
	writer.u32(state.pendingMemory.address);
	writer.u32(state.pendingMemory.accessKind);
	writer.i32(state.pendingMemory.registerIndex);
	writer.i32(state.pendingMemory.wordCount);
	const scan = state.stringComparison;
	writer.u32(scan.left); writer.u32(scan.right); writer.u32(scan.offset); writer.u32(scan.remaining);
	writer.i32(scan.order); writer.bool(scan.skipLess); writer.bool(scan.skipTie);
	const j = state.rebuild;
	writer.u32(j === null ? 0 : j.record);
	if (j !== null) {
		writer.u32(j.source); writer.u32(j.count); writer.u32(j.storage);
		writer.u32(j.arrayStorage); writer.u32(j.arraySlots); writer.u32(j.arrayCleared);
		writer.u32(j.capacity); writer.u32(j.cleared); writer.u32(j.homes);
		writer.u32(j.cursor); writer.u32(j.free); writer.u32(j.collisions);
		writer.u64(j.key); writer.u64(j.value);
		writer.u32(j.result); writer.u32(j.destination); writer.u32(j.wanted); writer.u32(j.instructionPc);
		writer.u32(j.census);
		if (j.census !== TableCensus.None) {
			writer.u32(j.recovery); writer.u32(j.scanned); writer.u32(j.live); writer.u32(j.slots); writer.u32(j.kept);
		}
	}
	const concat = state.concat;
	writer.u8(+(concat !== null));
	if (concat !== null) {
		writer.u32(concat.length); writer.u32(concat.registersLeft); writer.u32(concat.nextRegister);
		writer.u32(concat.instructionPc); writer.u32(concat.destination); writer.u32(concat.source); writer.u32(concat.offset); writer.u32(concat.hash);
		writer.u32(concat.values.length);
		for (let i = 0; i < concat.values.length; ++i) { writer.u64(concat.values[i]); writer.u32(concat.lengths[i]); }
		writer.u32(concat.bytes.length); writer.bytes(concat.bytes);
	}
	const pending = state.pendingAllocation;
	writer.u32(pending === null ? AllocationRecovery.None : pending.recovery);
	if (pending !== null) {
		writer.u32(pending.instructionPc);
		writer.u32(pending.lastPc);
		writer.u32(pending.nextPc);
		writer.u32(pending.receiver);
		writer.u64(pending.key);
		writer.u64(pending.value);
		writer.u8(pending.extraHashSlots);
	}
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
	writer.bool(state.nonMaskableInterruptPending);
	writer.bool(state.yieldRequested);
}

function readPendingAllocation(reader: BinaryReader): PendingAllocation | null {
	const recovery = reader.u32() as AllocationRecovery;
	if (recovery === AllocationRecovery.None) return null;
	const instructionPc = reader.u32(), lastPc = reader.u32(), nextPc = reader.u32();
	return { recovery, instructionPc, lastPc, nextPc, receiver: reader.u32(),
		key: reader.u64() as Value, value: reader.u64() as Value, extraHashSlots: reader.u8() };
}

function readTableRebuild(reader: BinaryReader) {
	const record = reader.u32();
	if (!record) return null;
	const j = { record, source: reader.u32(), count: reader.u32(), storage: reader.u32(),
		arrayStorage: reader.u32(), arraySlots: reader.u32(), arrayCleared: reader.u32(), capacity: reader.u32(),
		cleared: reader.u32(), homes: reader.u32(), cursor: reader.u32(), free: reader.u32(), collisions: reader.u32(),
		key: reader.u64() as Value, value: reader.u64() as Value,
		result: reader.u32(), destination: reader.u32(), wanted: reader.u32(), instructionPc: reader.u32(), census: reader.u32(),
		recovery: LuaAllocationRecovery.CurrentOrFresh, scanned: 0, live: 0, slots: 0, kept: 0 };
	if (j.census !== TableCensus.None) {
		j.recovery = reader.u32(); j.scanned = reader.u32(); j.live = reader.u32(); j.slots = reader.u32(); j.kept = reader.u32();
	}
	return j;
}

function readConcatAssembly(reader: BinaryReader): NonNullable<CpuRuntimeState['concat']> {
	const length = reader.u32(), registersLeft = reader.u32(), nextRegister = reader.u32();
	const instructionPc = reader.u32(), destination = reader.u32(), source = reader.u32(), offset = reader.u32(), hash = reader.u32();
	const count = reader.u32(), values: Value[] = [], lengths: number[] = [];
	for (let i = 0; i < count; ++i) { values.push(reader.u64() as Value); lengths.push(reader.u32()); }
	return { length, registersLeft, nextRegister, instructionPc, destination, source, offset, hash, values, lengths, bytes: reader.bytes(reader.u32()) };
}

function readCpuRuntimeState(reader: BinaryReader): CpuRuntimeState {
	return {
		executionCartridgeSlot: reader.i32() as ExecutionDomainId,
		programExecutionDomainId: reader.i32() as ExecutionDomainId,
		rootThreadAddress: reader.u32(),
		activeThreadAddress: reader.u32(),
		completionThreadAddress: reader.u32(),
		completionValues: reader.u64s(reader.u32()) as Value[],
		lastExecutionDomainId: reader.i32() as ExecutionDomainId,
		executionResidencyMask: reader.u32(),
		hardHalted: reader.bool(),
		lastPc: reader.u32(),
		haltedUntilIrqThreadAddress: reader.u32(),
		haltedUntilIrqFrameDepth: reader.i32(),
		interruptEventPending: reader.bool(),
		memoryWriteBlocked: reader.bool(),
		memoryWriteBlockedAddress: reader.u32(),
		pendingMemory: {
			kind: reader.u32() as PendingMemoryKind,
			instructionPc: reader.u32(), nextPc: reader.u32(), address: reader.u32(),
			accessKind: reader.u32() as MemoryAccessKind,
			registerIndex: reader.i32(), wordCount: reader.i32(),
		},
		stringComparison: {
			left: reader.u32(), right: reader.u32(), offset: reader.u32(), remaining: reader.u32(),
			order: reader.i32(), skipLess: reader.bool(), skipTie: reader.bool(),
		},
		rebuild: readTableRebuild(reader),
		concat: reader.u8() !== 0 ? readConcatAssembly(reader) : null,
		pendingAllocation: readPendingAllocation(reader),
		statusWord: reader.u32(),
		causeWord: reader.u32(),
		epcWord: reader.u32(),
		badAddressWord: reader.u32(),
		luaFaultReasonWord: reader.u32(),
		exceptionDomainWord: reader.u32(),
		nmiReturnCauseWord: reader.u32(),
		nmiReturnEpcWord: reader.u32(),
		nmiReturnBadAddressWord: reader.u32(),
		nmiReturnLuaFaultReasonWord: reader.u32(),
		nmiReturnExceptionDomainWord: reader.u32(),
		nonMaskableInterruptPending: reader.bool(),
		yieldRequested: reader.bool(),
	};
}

function writeRuntimeSaveState(writer: BinarySink, state: RuntimeSaveState): void {
	writer.bytes(state.ram);
	writeRuntimeSaveMachineState(writer, state.machineState);
	writeCpuRuntimeState(writer, state.cpuState);
	writer.bool(state.pendingEntryCall);
}

function readRuntimeSaveState(reader: BinaryReader, ramByteCount: number, gxGpuVramByteCount: number): RuntimeSaveState {
	return {
		ram: reader.bytes(ramByteCount),
		machineState: readRuntimeSaveMachineState(reader, gxGpuVramByteCount),
		cpuState: readCpuRuntimeState(reader),
		pendingEntryCall: reader.bool(),
	};
}

function writeInputControllerRegisterState(writer: BinarySink, state: InputControllerRegisterState): void {
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

function readInputControllerRegisterState(reader: BinaryReader): InputControllerRegisterState {
	return {
		ctrl: reader.u32(),
		keyWords: reader.u32s(INPUT_CONTROLLER_KEY_WORD_COUNT),
		pointerButtons: reader.u32(),
		pointerXQ16: reader.u32(),
		pointerYQ16: reader.u32(),
		pointerWheelQ16: reader.u32(),
		padButtons: reader.u32s(INPUT_CONTROLLER_PAD_COUNT),
		padAxesQ16: reader.u32s(INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT),
		outputPort: reader.u32(),
		outputIntensityQ16: reader.u32(),
		outputDurationMs: reader.u32(),
		outputStatus: reader.u32(),
	};
}

function writeApuOutputState(writer: BinarySink, state: ApuOutputState): void {
	writer.u32(state.voices.length);
	for (const value of state.voices) {
		writeApuOutputVoiceState(writer, value);
	}
}

function readApuOutputState(reader: BinaryReader): ApuOutputState {
	return {
		voices: reader.array(readApuOutputVoiceState),
	};
}

function writeStateImage(writer: BinarySink, state: RuntimeSaveState): void {
	writer.u32(SAVE_STATE_SIGNATURE);
	// Save states are never versioned. Never.
	writeRuntimeSaveState(writer, state);
}

export function encodeRuntimeSaveState(state: RuntimeSaveState): Uint8Array;
// Returns zero without writing when the output cannot hold the complete state.
export function encodeRuntimeSaveState(state: RuntimeSaveState, output: Uint8Array): number;
export function encodeRuntimeSaveState(state: RuntimeSaveState, output?: Uint8Array): Uint8Array | number {
	const size = new BinarySize();
	writeStateImage(size, state);
	if (output !== undefined) {
		if (size.length > output.byteLength) return 0;
		writeStateImage(new BinaryWriter(output), state);
		return size.length;
	}
	const bytes = new Uint8Array(size.length);
	writeStateImage(new BinaryWriter(bytes), state);
	return bytes;
}

export function decodeRuntimeSaveState(data: Uint8Array, ramByteCount: number, gxGpuVramByteCount: number): RuntimeSaveState {
	const reader = new BinaryReader(data);
	if (reader.u32() !== SAVE_STATE_SIGNATURE) throw new Error('Unrecognized save-state format.');
	// if (reader.u32() !== SAVE_STATE_LAYOUT_VERSION) throw new Error('Unsupported save-state layout.'); // Save states are never versioned. Never.
	const state = readRuntimeSaveState(reader, ramByteCount, gxGpuVramByteCount);
	reader.finish();
	return state;
}
