import { decodeBinaryWithPropTable, encodeBinaryWithPropTable, requireObject, requireObjectKey } from '../../../common/serializer/binencoder';
import type { MachineSaveState } from '../../save_state';
import type { BuiltinFunctionId, CpuFrameState, CpuObjectState, CpuRootValueState, CpuRuntimeState, CpuValueState } from '../../cpu/cpu';
import type { IrqControllerState } from '../../devices/irq/save_state';
import type { AudioControllerState } from '../../devices/audio/save_state';
import { DMA_JOB_QUEUE_CAPACITY, type DmaControllerState, type DmaJobState } from '../../devices/dma/controller';
import type {
	ApuBadpDecoderSaveState,
	ApuBiquadFilterState,
	ApuOutputState,
	ApuOutputVoiceState,
} from '../../devices/audio/save_state';
import type { ApuCommandFifoState } from '../../devices/audio/command_fifo';
import { APU_COMMAND_FIFO_CAPACITY, APU_COMMAND_FIFO_REGISTER_WORD_COUNT, APU_PARAMETER_REGISTER_COUNT, APU_SLOT_COUNT, APU_SLOT_REGISTER_WORD_COUNT } from '../../devices/audio/contracts';
import type { StringPoolState, StringPoolStateEntry } from '../../cpu/string_pool';
import type { InputControllerState } from '../../devices/input/save_state';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../devices/input/contracts';
import {
	GEOMETRY_CONTROLLER_PHASE_REJECTED,
	GEOMETRY_CONTROLLER_REGISTER_COUNT,
	type GeometryControllerPhase,
} from '../../devices/geometry/contracts';
import { GX_GPU_GP0_COMMAND_BUFFER_WORDS, type GxGpuSaveState, type GxGpuState } from '../../devices/gx/gpu';
import { GX_GPU_COMMAND_CAPACITY, GX_GPU_COMMAND_WORD_CAPACITY, GX_GPU_VRAM_BYTE_COUNT, type GxGpuCommandBufferState } from '../../devices/gx/gpu_command_buffer';
import type { GxGteState } from '../../devices/gx/gte';
import { GX_GTE_CONTROL_REGISTER_COUNT, GX_GTE_DATA_REGISTER_COUNT } from '../../devices/gx/gte';
import type { GeometryJobState } from '../../devices/geometry/job';
import type { GeometryControllerState } from '../../devices/geometry/save_state';
import type { MemorySaveState } from '../../memory/memory';
import { RAM_BASE, RAM_END } from '../../memory/map';
import type { FrameSchedulerStateSnapshot, TickCompletion } from '../../scheduler/frame';
import type { RuntimeSaveMachineState } from '../save_machine_state';
import type { RuntimeSaveState } from '../save_state';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../save_state';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from './schema';
import type { Runtime } from '../runtime';

type CpuTableHashNodeState = Extract<CpuObjectState, { kind: 'table' }>['hash'][number];

function requireArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array.`);
	}
	return value;
}

function encodeVector<T, U>(values: ReadonlyArray<T>, encode: (value: T) => U): U[] {
	const out = new Array<U>(values.length);
	for (let index = 0; index < values.length; index += 1) {
		out[index] = encode(values[index]);
	}
	return out;
}

function decodeVector<T>(value: unknown, label: string, decode: (value: unknown, index: number) => T): T[] {
	const entries = requireArray(value, label);
	const out = new Array<T>(entries.length);
	for (let index = 0; index < entries.length; index += 1) {
		out[index] = decode(entries[index], index);
	}
	return out;
}

function decodeU32FixedArray(value: unknown, label: string, length: number): number[] {
	const entries = requireArray(value, label);
	if (entries.length !== length) {
		throw new Error(`${label} must contain ${length} u32 values.`);
	}
	const out = new Array<number>(length);
	for (let index = 0; index < length; index += 1) {
		const word = entries[index];
		if (typeof word !== 'number' || !Number.isInteger(word) || word < 0 || word > 0xffffffff) {
			throw new Error(`${label}[${index}] must be a u32 value.`);
		}
		out[index] = word >>> 0;
	}
	return out;
}

function decodeU8FixedArray(value: unknown, label: string, length: number): number[] {
	const entries = requireArray(value, label);
	if (entries.length !== length) {
		throw new Error(`${label} must contain ${length} u8 values.`);
	}
	const out = new Array<number>(length);
	for (let index = 0; index < length; index += 1) {
		out[index] = requireBoundedU32(entries[index], `${label}[${index}]`, 0, 0xff);
	}
	return out;
}

function decodeIntegerFixedArray(value: unknown, label: string, length: number, valueName: string, decode: (value: unknown, label: string) => number): number[] {
	const entries = requireArray(value, label);
	if (entries.length !== length) {
		throw new Error(`${label} must contain ${length} ${valueName} values.`);
	}
	const out = new Array<number>(length);
	for (let index = 0; index < length; index += 1) {
		out[index] = decode(entries[index], `${label}[${index}]`);
	}
	return out;
}

function decodeBinaryFixedArray(value: unknown, label: string, length: number): Uint8Array[] {
	const entries = requireArray(value, label);
	if (entries.length !== length) {
		throw new Error(`${label} must contain ${length} binary entries.`);
	}
	const out = new Array<Uint8Array>(length);
	for (let index = 0; index < length; index += 1) {
		out[index] = requireBinaryValue(entries[index], `${label}[${index}]`);
	}
	return out;
}

function requireBinaryValue(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new Error(`${label} must be binary.`);
	}
	return value;
}

function requireBinaryFixedLength(value: unknown, label: string, byteLength: number): Uint8Array {
	const bytes = requireBinaryValue(value, label);
	if (bytes.byteLength !== byteLength) {
		throw new Error(`${label} must contain ${byteLength} bytes.`);
	}
	return bytes;
}

function requireBoundedU32(value: unknown, label: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${label} must be a u32 value between ${min} and ${max}.`);
	}
	return value >>> 0;
}

function requireI32(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
		throw new Error(`${label} must be an i32 value.`);
	}
	return value | 0;
}

function requireI64(value: unknown, label: string): number {
	const word = value as number;
	if (!Number.isSafeInteger(word)) {
		throw new Error(`${label} must be an i64 value.`);
	}
	return word;
}

function requireNumberValue(value: unknown, label: string): number {
	const number = value as number;
	if (+number !== number || number - number !== 0) {
		throw new Error(`${label} must be numeric.`);
	}
	return number;
}

function requireBooleanValue(value: unknown, label: string): boolean {
	if (Object.is(value, true)) {
		return true;
	}
	if (Object.is(value, false)) {
		return false;
	}
	throw new Error(`${label} must be a boolean.`);
}

function decodeNumberObjectField(value: unknown, label: string, key: string, keyLabel: string): number {
	const object = requireObject(value, label);
	return requireObjectKey(object, key, label, keyLabel) as number;
}

function encodeTickCompletion(state: TickCompletion): TickCompletion {
	return {
		sequence: state.sequence,
		remaining: state.remaining,
		visualCommitted: state.visualCommitted,
	};
}

function decodeTickCompletion(value: unknown, label: string): TickCompletion {
	const object = requireObject(value, label);
	return {
		sequence: requireObjectKey(object, 'sequence', label, 'tickCompletion.sequence') as number,
		remaining: requireObjectKey(object, 'remaining', label, 'tickCompletion.remaining') as number,
		visualCommitted: requireObjectKey(object, 'visualCommitted', label, 'tickCompletion.visualCommitted') as boolean,
	};
}

function encodeFrameSchedulerState(state: FrameSchedulerStateSnapshot): FrameSchedulerStateSnapshot {
	return {
		accumulatedHostTimeMs: state.accumulatedHostTimeMs,
		queuedTickCompletions: encodeVector(state.queuedTickCompletions, encodeTickCompletion),
		lastTickSequence: state.lastTickSequence,
		lastTickBudgetGranted: state.lastTickBudgetGranted,
		lastTickCpuBudgetGranted: state.lastTickCpuBudgetGranted,
		lastTickCpuUsedCycles: state.lastTickCpuUsedCycles,
		lastTickBudgetRemaining: state.lastTickBudgetRemaining,
		lastTickVisualFrameCommitted: state.lastTickVisualFrameCommitted,
		lastTickCompleted: state.lastTickCompleted,
		lastTickConsumedSequence: state.lastTickConsumedSequence,
	};
}

function decodeFrameSchedulerState(value: unknown, label: string): FrameSchedulerStateSnapshot {
	const object = requireObject(value, label);
	return {
		accumulatedHostTimeMs: requireObjectKey(object, 'accumulatedHostTimeMs', label, 'frameScheduler.accumulatedHostTimeMs') as number,
		queuedTickCompletions: decodeVector(
			requireObjectKey(object, 'queuedTickCompletions', label, 'frameScheduler.queuedTickCompletions'),
			'frameScheduler.queuedTickCompletions',
			(entry) => decodeTickCompletion(entry, 'frameScheduler.queuedTickCompletions[]'),
		),
		lastTickSequence: requireObjectKey(object, 'lastTickSequence', label, 'frameScheduler.lastTickSequence') as number,
		lastTickBudgetGranted: requireObjectKey(object, 'lastTickBudgetGranted', label, 'frameScheduler.lastTickBudgetGranted') as number,
		lastTickCpuBudgetGranted: requireObjectKey(object, 'lastTickCpuBudgetGranted', label, 'frameScheduler.lastTickCpuBudgetGranted') as number,
		lastTickCpuUsedCycles: requireObjectKey(object, 'lastTickCpuUsedCycles', label, 'frameScheduler.lastTickCpuUsedCycles') as number,
		lastTickBudgetRemaining: requireObjectKey(object, 'lastTickBudgetRemaining', label, 'frameScheduler.lastTickBudgetRemaining') as number,
		lastTickVisualFrameCommitted: requireObjectKey(object, 'lastTickVisualFrameCommitted', label, 'frameScheduler.lastTickVisualFrameCommitted') as boolean,
		lastTickCompleted: requireObjectKey(object, 'lastTickCompleted', label, 'frameScheduler.lastTickCompleted') as boolean,
		lastTickConsumedSequence: requireObjectKey(object, 'lastTickConsumedSequence', label, 'frameScheduler.lastTickConsumedSequence') as number,
	};
}

function encodeRuntimeVblankState(state: RuntimeSaveMachineState['vblank']): RuntimeSaveMachineState['vblank'] {
	return {
		nowCycles: state.nowCycles,
		cyclesIntoFrame: state.cyclesIntoFrame,
	};
}

function decodeRuntimeVblankState(value: unknown, label: string): RuntimeSaveMachineState['vblank'] {
	return {
		nowCycles: requireI64(decodeNumberObjectField(value, label, 'nowCycles', 'vblank.nowCycles'), 'vblank.nowCycles'),
		cyclesIntoFrame: decodeNumberObjectField(value, label, 'cyclesIntoFrame', 'vblank.cyclesIntoFrame'),
	};
}

function encodeMemorySaveState(state: MemorySaveState): MemorySaveState {
	return {
		ram: state.ram,
		busFaultCode: state.busFaultCode >>> 0,
		busFaultAddr: state.busFaultAddr >>> 0,
		busFaultAccess: state.busFaultAccess >>> 0,
	};
}

function decodeMemorySaveState(value: unknown, label: string): MemorySaveState {
	const object = requireObject(value, label);
	const ram = requireBinaryValue(requireObjectKey(object, 'ram', label, 'machine.memory.ram'), 'machine.memory.ram');
	if (ram.byteLength !== RAM_END - RAM_BASE) {
		throw new Error(`machine.memory.ram must contain ${RAM_END - RAM_BASE} bytes.`);
	}
	return {
		ram,
		busFaultCode: requireObjectKey(object, 'busFaultCode', label, 'machine.memory.busFaultCode') as number,
		busFaultAddr: requireObjectKey(object, 'busFaultAddr', label, 'machine.memory.busFaultAddr') as number,
		busFaultAccess: requireObjectKey(object, 'busFaultAccess', label, 'machine.memory.busFaultAccess') as number,
	};
}

function encodeIrqControllerState(state: IrqControllerState): IrqControllerState {
	return {
		mask: state.mask >>> 0,
		pendingFlags: state.pendingFlags >>> 0,
	};
}

function decodeIrqControllerState(value: unknown, label: string): IrqControllerState {
	return {
		mask: decodeNumberObjectField(value, label, 'mask', 'machine.irq.mask'),
		pendingFlags: decodeNumberObjectField(value, label, 'pendingFlags', 'machine.irq.pendingFlags'),
	};
}

function encodeStringPoolStateEntry(state: StringPoolStateEntry): StringPoolStateEntry {
	return {
		id: state.id,
		value: state.value,
		tracked: state.tracked,
	};
}

function decodeStringPoolStateEntry(value: unknown, label: string): StringPoolStateEntry {
	const object = requireObject(value, label);
	return {
		id: requireObjectKey(object, 'id', label, 'machine.stringPool.entries[].id') as number,
		value: requireObjectKey(object, 'value', label, 'machine.stringPool.entries[].value') as string,
		tracked: requireObjectKey(object, 'tracked', label, 'machine.stringPool.entries[].tracked') as boolean,
	};
}

function encodeStringPoolState(state: StringPoolState): StringPoolState {
	return {
		entries: encodeVector(state.entries, encodeStringPoolStateEntry),
	};
}

function decodeStringPoolState(value: unknown, label: string): StringPoolState {
	const object = requireObject(value, label);
	return {
		entries: decodeVector(
			requireObjectKey(object, 'entries', label, 'machine.stringPool.entries'),
			'machine.stringPool.entries',
			(entry) => decodeStringPoolStateEntry(entry, 'machine.stringPool.entries[]'),
		),
	};
}

function encodeInputControllerState(state: InputControllerState): InputControllerState {
	return {
		sampleArmed: state.sampleArmed,
		sampleSequence: state.sampleSequence >>> 0,
		lastSampleCycle: state.lastSampleCycle >>> 0,
		registers: {
			ctrl: state.registers.ctrl >>> 0,
			keyWords: encodeVector(state.registers.keyWords, (word) => word >>> 0),
			pointerButtons: state.registers.pointerButtons >>> 0,
			pointerXQ16: state.registers.pointerXQ16 >>> 0,
			pointerYQ16: state.registers.pointerYQ16 >>> 0,
			pointerWheelQ16: state.registers.pointerWheelQ16 >>> 0,
			padButtons: encodeVector(state.registers.padButtons, (word) => word >>> 0),
			padAxesQ16: encodeVector(state.registers.padAxesQ16, (word) => word >>> 0),
			outputPort: state.registers.outputPort >>> 0,
			outputIntensityQ16: state.registers.outputIntensityQ16 >>> 0,
			outputDurationMs: state.registers.outputDurationMs >>> 0,
			outputStatus: state.registers.outputStatus >>> 0,
		},
	};
}

function decodeInputControllerState(value: unknown, label: string): InputControllerState {
	const object = requireObject(value, label);
	const registers = requireObject(requireObjectKey(object, 'registers', label, 'machine.input.registers'), 'machine.input.registers');
	const registerWord = (key: string): number =>
		requireBoundedU32(requireObjectKey(registers, key, 'machine.input.registers', `machine.input.registers.${key}`), `machine.input.registers.${key}`, 0, 0xffffffff);
	const registerWordVector = (key: string, expectedLength: number): number[] => {
		const values = decodeVector(
			requireObjectKey(registers, key, 'machine.input.registers', `machine.input.registers.${key}`),
			`machine.input.registers.${key}`,
			(word) => requireBoundedU32(word, `machine.input.registers.${key}[]`, 0, 0xffffffff),
		);
		if (values.length !== expectedLength) {
			throw new Error(`machine.input.registers.${key} has unexpected length.`);
		}
		return values;
	};
	return {
		sampleArmed: requireBooleanValue(requireObjectKey(object, 'sampleArmed', label, 'machine.input.sampleArmed'), 'machine.input.sampleArmed'),
		sampleSequence: requireBoundedU32(requireObjectKey(object, 'sampleSequence', label, 'machine.input.sampleSequence'), 'machine.input.sampleSequence', 0, 0xffffffff),
		lastSampleCycle: requireBoundedU32(requireObjectKey(object, 'lastSampleCycle', label, 'machine.input.lastSampleCycle'), 'machine.input.lastSampleCycle', 0, 0xffffffff),
		registers: {
			ctrl: registerWord('ctrl'),
			keyWords: registerWordVector('keyWords', INPUT_CONTROLLER_KEY_WORD_COUNT),
			pointerButtons: registerWord('pointerButtons'),
			pointerXQ16: registerWord('pointerXQ16'),
			pointerYQ16: registerWord('pointerYQ16'),
			pointerWheelQ16: registerWord('pointerWheelQ16'),
			padButtons: registerWordVector('padButtons', INPUT_CONTROLLER_PAD_COUNT),
			padAxesQ16: registerWordVector('padAxesQ16', INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT),
			outputPort: registerWord('outputPort'),
			outputIntensityQ16: registerWord('outputIntensityQ16'),
			outputDurationMs: registerWord('outputDurationMs'),
			outputStatus: registerWord('outputStatus'),
		},
	};
}

function encodeGeometryJobState(state: GeometryJobState): GeometryJobState {
	return {
		cmd: state.cmd >>> 0,
		src0: state.src0 >>> 0,
		src1: state.src1 >>> 0,
		src2: state.src2 >>> 0,
		dst0: state.dst0 >>> 0,
		dst1: state.dst1 >>> 0,
		count: state.count >>> 0,
		param0: state.param0 >>> 0,
		param1: state.param1 >>> 0,
		stride0: state.stride0 >>> 0,
		stride1: state.stride1 >>> 0,
		stride2: state.stride2 >>> 0,
		processed: state.processed >>> 0,
		resultCount: state.resultCount >>> 0,
		exactPairCount: state.exactPairCount >>> 0,
		broadphasePairCount: state.broadphasePairCount >>> 0,
	};
}

function decodeGeometryJobState(value: unknown, label: string): GeometryJobState {
	const object = requireObject(value, label);
	return {
		cmd: requireBoundedU32(requireObjectKey(object, 'cmd', label, 'machine.geometry.activeJob.cmd'), 'machine.geometry.activeJob.cmd', 0, 0xffffffff),
		src0: requireBoundedU32(requireObjectKey(object, 'src0', label, 'machine.geometry.activeJob.src0'), 'machine.geometry.activeJob.src0', 0, 0xffffffff),
		src1: requireBoundedU32(requireObjectKey(object, 'src1', label, 'machine.geometry.activeJob.src1'), 'machine.geometry.activeJob.src1', 0, 0xffffffff),
		src2: requireBoundedU32(requireObjectKey(object, 'src2', label, 'machine.geometry.activeJob.src2'), 'machine.geometry.activeJob.src2', 0, 0xffffffff),
		dst0: requireBoundedU32(requireObjectKey(object, 'dst0', label, 'machine.geometry.activeJob.dst0'), 'machine.geometry.activeJob.dst0', 0, 0xffffffff),
		dst1: requireBoundedU32(requireObjectKey(object, 'dst1', label, 'machine.geometry.activeJob.dst1'), 'machine.geometry.activeJob.dst1', 0, 0xffffffff),
		count: requireBoundedU32(requireObjectKey(object, 'count', label, 'machine.geometry.activeJob.count'), 'machine.geometry.activeJob.count', 0, 0xffffffff),
		param0: requireBoundedU32(requireObjectKey(object, 'param0', label, 'machine.geometry.activeJob.param0'), 'machine.geometry.activeJob.param0', 0, 0xffffffff),
		param1: requireBoundedU32(requireObjectKey(object, 'param1', label, 'machine.geometry.activeJob.param1'), 'machine.geometry.activeJob.param1', 0, 0xffffffff),
		stride0: requireBoundedU32(requireObjectKey(object, 'stride0', label, 'machine.geometry.activeJob.stride0'), 'machine.geometry.activeJob.stride0', 0, 0xffffffff),
		stride1: requireBoundedU32(requireObjectKey(object, 'stride1', label, 'machine.geometry.activeJob.stride1'), 'machine.geometry.activeJob.stride1', 0, 0xffffffff),
		stride2: requireBoundedU32(requireObjectKey(object, 'stride2', label, 'machine.geometry.activeJob.stride2'), 'machine.geometry.activeJob.stride2', 0, 0xffffffff),
		processed: requireBoundedU32(requireObjectKey(object, 'processed', label, 'machine.geometry.activeJob.processed'), 'machine.geometry.activeJob.processed', 0, 0xffffffff),
		resultCount: requireBoundedU32(requireObjectKey(object, 'resultCount', label, 'machine.geometry.activeJob.resultCount'), 'machine.geometry.activeJob.resultCount', 0, 0xffffffff),
		exactPairCount: requireBoundedU32(requireObjectKey(object, 'exactPairCount', label, 'machine.geometry.activeJob.exactPairCount'), 'machine.geometry.activeJob.exactPairCount', 0, 0xffffffff),
		broadphasePairCount: requireBoundedU32(requireObjectKey(object, 'broadphasePairCount', label, 'machine.geometry.activeJob.broadphasePairCount'), 'machine.geometry.activeJob.broadphasePairCount', 0, 0xffffffff),
	};
}

function encodeGeometryControllerState(state: GeometryControllerState): GeometryControllerState {
	return {
		phase: state.phase,
		registerWords: encodeVector(state.registerWords, (word) => word >>> 0),
		activeJob: state.activeJob === null ? null : encodeGeometryJobState(state.activeJob),
		workCarry: state.workCarry,
		availableWorkUnits: state.availableWorkUnits >>> 0,
	};
}

function decodeGeometryControllerState(value: unknown, label: string): GeometryControllerState {
	const object = requireObject(value, label);
	const activeJob = requireObjectKey(object, 'activeJob', label, 'machine.geometry.activeJob');
	return {
		phase: requireBoundedU32(requireObjectKey(object, 'phase', label, 'machine.geometry.phase'), 'machine.geometry.phase', 0, GEOMETRY_CONTROLLER_PHASE_REJECTED) as GeometryControllerPhase,
		registerWords: decodeU32FixedArray(requireObjectKey(object, 'registerWords', label, 'machine.geometry.registerWords'), 'machine.geometry.registerWords', GEOMETRY_CONTROLLER_REGISTER_COUNT),
		activeJob: activeJob === null ? null : decodeGeometryJobState(activeJob, 'machine.geometry.activeJob'),
		workCarry: requireI64(requireObjectKey(object, 'workCarry', label, 'machine.geometry.workCarry'), 'machine.geometry.workCarry'),
		availableWorkUnits: requireBoundedU32(requireObjectKey(object, 'availableWorkUnits', label, 'machine.geometry.availableWorkUnits'), 'machine.geometry.availableWorkUnits', 0, 0xffffffff),
	};
}

function encodeGxGpuCommandBufferState(state: GxGpuCommandBufferState): GxGpuCommandBufferState {
	return {
		commandCount: state.commandCount >>> 0,
		presentCommandCount: state.presentCommandCount >>> 0,
		wordCount: state.wordCount >>> 0,
		commandKind: encodeVector(state.commandKind, (word) => word >>> 0),
		commandOpcode: encodeVector(state.commandOpcode, (word) => word >>> 0),
		commandWordStart: encodeVector(state.commandWordStart, (word) => word >>> 0),
		commandWordCount: encodeVector(state.commandWordCount, (word) => word >>> 0),
		commandDrawModeWord: encodeVector(state.commandDrawModeWord, (word) => word >>> 0),
		commandTextureWindowWord: encodeVector(state.commandTextureWindowWord, (word) => word >>> 0),
		commandDrawingAreaTopLeftWord: encodeVector(state.commandDrawingAreaTopLeftWord, (word) => word >>> 0),
		commandDrawingAreaBottomRightWord: encodeVector(state.commandDrawingAreaBottomRightWord, (word) => word >>> 0),
		commandDrawingOffsetWord: encodeVector(state.commandDrawingOffsetWord, (word) => word >>> 0),
		commandMaskBitModeWord: encodeVector(state.commandMaskBitModeWord, (word) => word >>> 0),
		commandInterlacedRenderWord: encodeVector(state.commandInterlacedRenderWord, (word) => word >>> 0),
		words: encodeVector(state.words, (word) => word >>> 0),
	};
}

function decodeGxGpuCommandBufferState(value: unknown, label: string): GxGpuCommandBufferState {
	const object = requireObject(value, label);
	const commandCount = requireBoundedU32(requireObjectKey(object, 'commandCount', label, `${label}.commandCount`), `${label}.commandCount`, 0, GX_GPU_COMMAND_CAPACITY);
	const presentCommandCount = requireBoundedU32(requireObjectKey(object, 'presentCommandCount', label, `${label}.presentCommandCount`), `${label}.presentCommandCount`, 0, commandCount);
	const wordCount = requireBoundedU32(requireObjectKey(object, 'wordCount', label, `${label}.wordCount`), `${label}.wordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY);
	return {
		commandCount,
		presentCommandCount,
		wordCount,
		commandKind: decodeU8FixedArray(requireObjectKey(object, 'commandKind', label, `${label}.commandKind`), `${label}.commandKind`, commandCount),
		commandOpcode: decodeU8FixedArray(requireObjectKey(object, 'commandOpcode', label, `${label}.commandOpcode`), `${label}.commandOpcode`, commandCount),
		commandWordStart: decodeU32FixedArray(requireObjectKey(object, 'commandWordStart', label, `${label}.commandWordStart`), `${label}.commandWordStart`, commandCount),
		commandWordCount: decodeU32FixedArray(requireObjectKey(object, 'commandWordCount', label, `${label}.commandWordCount`), `${label}.commandWordCount`, commandCount),
		commandDrawModeWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawModeWord', label, `${label}.commandDrawModeWord`), `${label}.commandDrawModeWord`, commandCount),
		commandTextureWindowWord: decodeU32FixedArray(requireObjectKey(object, 'commandTextureWindowWord', label, `${label}.commandTextureWindowWord`), `${label}.commandTextureWindowWord`, commandCount),
		commandDrawingAreaTopLeftWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingAreaTopLeftWord', label, `${label}.commandDrawingAreaTopLeftWord`), `${label}.commandDrawingAreaTopLeftWord`, commandCount),
		commandDrawingAreaBottomRightWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingAreaBottomRightWord', label, `${label}.commandDrawingAreaBottomRightWord`), `${label}.commandDrawingAreaBottomRightWord`, commandCount),
		commandDrawingOffsetWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingOffsetWord', label, `${label}.commandDrawingOffsetWord`), `${label}.commandDrawingOffsetWord`, commandCount),
		commandMaskBitModeWord: decodeU32FixedArray(requireObjectKey(object, 'commandMaskBitModeWord', label, `${label}.commandMaskBitModeWord`), `${label}.commandMaskBitModeWord`, commandCount),
		commandInterlacedRenderWord: decodeU8FixedArray(requireObjectKey(object, 'commandInterlacedRenderWord', label, `${label}.commandInterlacedRenderWord`), `${label}.commandInterlacedRenderWord`, commandCount),
		words: decodeU32FixedArray(requireObjectKey(object, 'words', label, `${label}.words`), `${label}.words`, wordCount),
	};
}

function encodeGxGpuState(state: GxGpuState): GxGpuState {
	return {
		gp0Word: state.gp0Word >>> 0,
		gp1Word: state.gp1Word >>> 0,
		displayModeWord: state.displayModeWord >>> 0,
		statusWord: state.statusWord >>> 0,
		gp0CommandWordCount: state.gp0CommandWordCount >>> 0,
		gp0CommandTargetWordCount: state.gp0CommandTargetWordCount >>> 0,
		gp0CommandWords: encodeVector(state.gp0CommandWords, (word) => word >>> 0),
		gp0ImageLoadWordsRemaining: state.gp0ImageLoadWordsRemaining >>> 0,
		gp0ImageLoadCommandWordStart: state.gp0ImageLoadCommandWordStart >>> 0,
		gp0ImageLoadCommandWordCount: state.gp0ImageLoadCommandWordCount >>> 0,
		gp0ImageLoadCommandOpcode: state.gp0ImageLoadCommandOpcode >>> 0,
		gp0PolylineWordsPerVertex: state.gp0PolylineWordsPerVertex >>> 0,
		gp0PolylinePayloadPhase: state.gp0PolylinePayloadPhase >>> 0,
		gp0PolylineCommandWordStart: state.gp0PolylineCommandWordStart >>> 0,
		gp0PolylineCommandWordCount: state.gp0PolylineCommandWordCount >>> 0,
		gp0PolylineCommandOpcode: state.gp0PolylineCommandOpcode >>> 0,
		gpuReadWord: state.gpuReadWord >>> 0,
		drawModeWord: state.drawModeWord >>> 0,
		textureWindowWord: state.textureWindowWord >>> 0,
		drawingAreaTopLeftWord: state.drawingAreaTopLeftWord >>> 0,
		drawingAreaBottomRightWord: state.drawingAreaBottomRightWord >>> 0,
		drawingOffsetWord: state.drawingOffsetWord >>> 0,
		maskBitModeWord: state.maskBitModeWord >>> 0,
		displayStartWord: state.displayStartWord >>> 0,
		horizontalDisplayRangeWord: state.horizontalDisplayRangeWord >>> 0,
		verticalDisplayRangeWord: state.verticalDisplayRangeWord >>> 0,
		textureDisableAllowedWord: state.textureDisableAllowedWord >>> 0,
		presentStatusWord: state.presentStatusWord >>> 0,
		presentDisplayModeWord: state.presentDisplayModeWord >>> 0,
		presentDisplayStartWord: state.presentDisplayStartWord >>> 0,
		presentHorizontalDisplayRangeWord: state.presentHorizontalDisplayRangeWord >>> 0,
		presentVerticalDisplayRangeWord: state.presentVerticalDisplayRangeWord >>> 0,
		commandBuffer: encodeGxGpuCommandBufferState(state.commandBuffer),
	};
}

function decodeGxGpuState(value: unknown, label: string): GxGpuState {
	const object = requireObject(value, label);
	const gp0CommandWordCount = requireBoundedU32(requireObjectKey(object, 'gp0CommandWordCount', label, `${label}.gp0CommandWordCount`), `${label}.gp0CommandWordCount`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	return {
		gp0Word: requireBoundedU32(requireObjectKey(object, 'gp0Word', label, `${label}.gp0Word`), `${label}.gp0Word`, 0, 0xffffffff),
		gp1Word: requireBoundedU32(requireObjectKey(object, 'gp1Word', label, `${label}.gp1Word`), `${label}.gp1Word`, 0, 0xffffffff),
		displayModeWord: requireBoundedU32(requireObjectKey(object, 'displayModeWord', label, `${label}.displayModeWord`), `${label}.displayModeWord`, 0, 0xffffffff),
		statusWord: requireBoundedU32(requireObjectKey(object, 'statusWord', label, `${label}.statusWord`), `${label}.statusWord`, 0, 0xffffffff),
		gp0CommandWordCount,
		gp0CommandTargetWordCount: requireBoundedU32(requireObjectKey(object, 'gp0CommandTargetWordCount', label, `${label}.gp0CommandTargetWordCount`), `${label}.gp0CommandTargetWordCount`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0CommandWords: decodeU32FixedArray(requireObjectKey(object, 'gp0CommandWords', label, `${label}.gp0CommandWords`), `${label}.gp0CommandWords`, gp0CommandWordCount),
		gp0ImageLoadWordsRemaining: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadWordsRemaining', label, `${label}.gp0ImageLoadWordsRemaining`), `${label}.gp0ImageLoadWordsRemaining`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandWordStart: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandWordStart', label, `${label}.gp0ImageLoadCommandWordStart`), `${label}.gp0ImageLoadCommandWordStart`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandWordCount: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandWordCount', label, `${label}.gp0ImageLoadCommandWordCount`), `${label}.gp0ImageLoadCommandWordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandOpcode: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandOpcode', label, `${label}.gp0ImageLoadCommandOpcode`), `${label}.gp0ImageLoadCommandOpcode`, 0, 0xff),
		gp0PolylineWordsPerVertex: requireBoundedU32(requireObjectKey(object, 'gp0PolylineWordsPerVertex', label, `${label}.gp0PolylineWordsPerVertex`), `${label}.gp0PolylineWordsPerVertex`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0PolylinePayloadPhase: requireBoundedU32(requireObjectKey(object, 'gp0PolylinePayloadPhase', label, `${label}.gp0PolylinePayloadPhase`), `${label}.gp0PolylinePayloadPhase`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0PolylineCommandWordStart: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandWordStart', label, `${label}.gp0PolylineCommandWordStart`), `${label}.gp0PolylineCommandWordStart`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0PolylineCommandWordCount: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandWordCount', label, `${label}.gp0PolylineCommandWordCount`), `${label}.gp0PolylineCommandWordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0PolylineCommandOpcode: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandOpcode', label, `${label}.gp0PolylineCommandOpcode`), `${label}.gp0PolylineCommandOpcode`, 0, 0xff),
		gpuReadWord: requireBoundedU32(requireObjectKey(object, 'gpuReadWord', label, `${label}.gpuReadWord`), `${label}.gpuReadWord`, 0, 0xffffffff),
		drawModeWord: requireBoundedU32(requireObjectKey(object, 'drawModeWord', label, `${label}.drawModeWord`), `${label}.drawModeWord`, 0, 0xffffffff),
		textureWindowWord: requireBoundedU32(requireObjectKey(object, 'textureWindowWord', label, `${label}.textureWindowWord`), `${label}.textureWindowWord`, 0, 0xffffffff),
		drawingAreaTopLeftWord: requireBoundedU32(requireObjectKey(object, 'drawingAreaTopLeftWord', label, `${label}.drawingAreaTopLeftWord`), `${label}.drawingAreaTopLeftWord`, 0, 0xffffffff),
		drawingAreaBottomRightWord: requireBoundedU32(requireObjectKey(object, 'drawingAreaBottomRightWord', label, `${label}.drawingAreaBottomRightWord`), `${label}.drawingAreaBottomRightWord`, 0, 0xffffffff),
		drawingOffsetWord: requireBoundedU32(requireObjectKey(object, 'drawingOffsetWord', label, `${label}.drawingOffsetWord`), `${label}.drawingOffsetWord`, 0, 0xffffffff),
		maskBitModeWord: requireBoundedU32(requireObjectKey(object, 'maskBitModeWord', label, `${label}.maskBitModeWord`), `${label}.maskBitModeWord`, 0, 0xffffffff),
		displayStartWord: requireBoundedU32(requireObjectKey(object, 'displayStartWord', label, `${label}.displayStartWord`), `${label}.displayStartWord`, 0, 0xffffffff),
		horizontalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'horizontalDisplayRangeWord', label, `${label}.horizontalDisplayRangeWord`), `${label}.horizontalDisplayRangeWord`, 0, 0xffffffff),
		verticalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'verticalDisplayRangeWord', label, `${label}.verticalDisplayRangeWord`), `${label}.verticalDisplayRangeWord`, 0, 0xffffffff),
		textureDisableAllowedWord: requireBoundedU32(requireObjectKey(object, 'textureDisableAllowedWord', label, `${label}.textureDisableAllowedWord`), `${label}.textureDisableAllowedWord`, 0, 0xffffffff),
		presentStatusWord: requireBoundedU32(requireObjectKey(object, 'presentStatusWord', label, `${label}.presentStatusWord`), `${label}.presentStatusWord`, 0, 0xffffffff),
		presentDisplayModeWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayModeWord', label, `${label}.presentDisplayModeWord`), `${label}.presentDisplayModeWord`, 0, 0xffffffff),
		presentDisplayStartWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayStartWord', label, `${label}.presentDisplayStartWord`), `${label}.presentDisplayStartWord`, 0, 0xffffffff),
		presentHorizontalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentHorizontalDisplayRangeWord', label, `${label}.presentHorizontalDisplayRangeWord`), `${label}.presentHorizontalDisplayRangeWord`, 0, 0xffffffff),
		presentVerticalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentVerticalDisplayRangeWord', label, `${label}.presentVerticalDisplayRangeWord`), `${label}.presentVerticalDisplayRangeWord`, 0, 0xffffffff),
		commandBuffer: decodeGxGpuCommandBufferState(requireObjectKey(object, 'commandBuffer', label, `${label}.commandBuffer`), `${label}.commandBuffer`),
	};
}

function encodeGxGpuSaveState(state: GxGpuSaveState): GxGpuSaveState {
	return {
		...encodeGxGpuState(state),
		vramBytes: state.vramBytes,
	};
}

function decodeGxGpuSaveState(value: unknown, label: string): GxGpuSaveState {
	const object = requireObject(value, label);
	return {
		...decodeGxGpuState(value, label),
		vramBytes: requireBinaryFixedLength(requireObjectKey(object, 'vramBytes', label, `${label}.vramBytes`), `${label}.vramBytes`, GX_GPU_VRAM_BYTE_COUNT),
	};
}

function encodeGxGteState(state: GxGteState): GxGteState {
	return {
		dataRegisterWords: encodeVector(state.dataRegisterWords, (word) => word >>> 0),
		controlRegisterWords: encodeVector(state.controlRegisterWords, (word) => word >>> 0),
		mac0: state.mac0,
		mac1: state.mac1,
		mac2: state.mac2,
		mac3: state.mac3,
		currentSf: state.currentSf >>> 0,
		lastCycles: state.lastCycles >>> 0,
	};
}

function decodeGxGteState(value: unknown, label: string): GxGteState {
	const object = requireObject(value, label);
	return {
		dataRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'dataRegisterWords', label, `${label}.dataRegisterWords`), `${label}.dataRegisterWords`, GX_GTE_DATA_REGISTER_COUNT),
		controlRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'controlRegisterWords', label, `${label}.controlRegisterWords`), `${label}.controlRegisterWords`, GX_GTE_CONTROL_REGISTER_COUNT),
		mac0: requireI64(requireObjectKey(object, 'mac0', label, `${label}.mac0`), `${label}.mac0`),
		mac1: requireI64(requireObjectKey(object, 'mac1', label, `${label}.mac1`), `${label}.mac1`),
		mac2: requireI64(requireObjectKey(object, 'mac2', label, `${label}.mac2`), `${label}.mac2`),
		mac3: requireI64(requireObjectKey(object, 'mac3', label, `${label}.mac3`), `${label}.mac3`),
		currentSf: requireBoundedU32(requireObjectKey(object, 'currentSf', label, `${label}.currentSf`), `${label}.currentSf`, 0, 0xffffffff),
		lastCycles: requireBoundedU32(requireObjectKey(object, 'lastCycles', label, `${label}.lastCycles`), `${label}.lastCycles`, 0, 0xffffffff),
	};
}

function encodeApuBiquadFilterState(state: ApuBiquadFilterState): ApuBiquadFilterState {
	return {
		enabled: state.enabled,
		b0: state.b0,
		b1: state.b1,
		b2: state.b2,
		a1: state.a1,
		a2: state.a2,
		l1: state.l1,
		l2: state.l2,
		r1: state.r1,
		r2: state.r2,
	};
}

function decodeApuBiquadFilterState(value: unknown, label: string): ApuBiquadFilterState {
	const object = requireObject(value, label);
	return {
		enabled: requireBooleanValue(requireObjectKey(object, 'enabled', label, `${label}.enabled`), `${label}.enabled`),
		b0: requireNumberValue(requireObjectKey(object, 'b0', label, `${label}.b0`), `${label}.b0`),
		b1: requireNumberValue(requireObjectKey(object, 'b1', label, `${label}.b1`), `${label}.b1`),
		b2: requireNumberValue(requireObjectKey(object, 'b2', label, `${label}.b2`), `${label}.b2`),
		a1: requireNumberValue(requireObjectKey(object, 'a1', label, `${label}.a1`), `${label}.a1`),
		a2: requireNumberValue(requireObjectKey(object, 'a2', label, `${label}.a2`), `${label}.a2`),
		l1: requireNumberValue(requireObjectKey(object, 'l1', label, `${label}.l1`), `${label}.l1`),
		l2: requireNumberValue(requireObjectKey(object, 'l2', label, `${label}.l2`), `${label}.l2`),
		r1: requireNumberValue(requireObjectKey(object, 'r1', label, `${label}.r1`), `${label}.r1`),
		r2: requireNumberValue(requireObjectKey(object, 'r2', label, `${label}.r2`), `${label}.r2`),
	};
}

function encodeApuBadpDecoderState(state: ApuBadpDecoderSaveState): ApuBadpDecoderSaveState {
	return {
		predictors: encodeVector(state.predictors, (word) => word),
		stepIndices: encodeVector(state.stepIndices, (word) => word),
		nextFrame: state.nextFrame,
		blockEnd: state.blockEnd,
		blockFrames: state.blockFrames,
		blockFrameIndex: state.blockFrameIndex,
		payloadOffset: state.payloadOffset,
		nibbleCursor: state.nibbleCursor,
		decodedFrame: state.decodedFrame,
		decodedLeft: state.decodedLeft,
		decodedRight: state.decodedRight,
	};
}

function decodeApuBadpDecoderState(value: unknown, label: string): ApuBadpDecoderSaveState {
	const object = requireObject(value, label);
	return {
		predictors: decodeIntegerFixedArray(requireObjectKey(object, 'predictors', label, `${label}.predictors`), `${label}.predictors`, 2, 'i32', requireI32),
		stepIndices: decodeIntegerFixedArray(requireObjectKey(object, 'stepIndices', label, `${label}.stepIndices`), `${label}.stepIndices`, 2, 'i32', requireI32),
		nextFrame: requireBoundedU32(requireObjectKey(object, 'nextFrame', label, `${label}.nextFrame`), `${label}.nextFrame`, 0, 0xffffffff),
		blockEnd: requireBoundedU32(requireObjectKey(object, 'blockEnd', label, `${label}.blockEnd`), `${label}.blockEnd`, 0, 0xffffffff),
		blockFrames: requireBoundedU32(requireObjectKey(object, 'blockFrames', label, `${label}.blockFrames`), `${label}.blockFrames`, 0, 0xffffffff),
		blockFrameIndex: requireBoundedU32(requireObjectKey(object, 'blockFrameIndex', label, `${label}.blockFrameIndex`), `${label}.blockFrameIndex`, 0, 0xffffffff),
		payloadOffset: requireBoundedU32(requireObjectKey(object, 'payloadOffset', label, `${label}.payloadOffset`), `${label}.payloadOffset`, 0, 0xffffffff),
		nibbleCursor: requireBoundedU32(requireObjectKey(object, 'nibbleCursor', label, `${label}.nibbleCursor`), `${label}.nibbleCursor`, 0, 0xffffffff),
		decodedFrame: requireI64(requireObjectKey(object, 'decodedFrame', label, `${label}.decodedFrame`), `${label}.decodedFrame`),
		decodedLeft: requireI32(requireObjectKey(object, 'decodedLeft', label, `${label}.decodedLeft`), `${label}.decodedLeft`),
		decodedRight: requireI32(requireObjectKey(object, 'decodedRight', label, `${label}.decodedRight`), `${label}.decodedRight`),
	};
}

function encodeApuOutputVoiceState(state: ApuOutputVoiceState): ApuOutputVoiceState {
	return {
		slot: state.slot,
		position: state.position,
		step: state.step,
		gain: state.gain,
		targetGain: state.targetGain,
		gainRampRemaining: state.gainRampRemaining,
		stopAfter: state.stopAfter,
		filterSampleRate: state.filterSampleRate,
		filter: encodeApuBiquadFilterState(state.filter),
		badp: encodeApuBadpDecoderState(state.badp),
	};
}

function decodeApuOutputVoiceState(value: unknown, label: string): ApuOutputVoiceState {
	const object = requireObject(value, label);
	return {
		slot: requireBoundedU32(requireObjectKey(object, 'slot', label, `${label}.slot`), `${label}.slot`, 0, APU_SLOT_COUNT - 1),
		position: requireNumberValue(requireObjectKey(object, 'position', label, `${label}.position`), `${label}.position`),
		step: requireNumberValue(requireObjectKey(object, 'step', label, `${label}.step`), `${label}.step`),
		gain: requireNumberValue(requireObjectKey(object, 'gain', label, `${label}.gain`), `${label}.gain`),
		targetGain: requireNumberValue(requireObjectKey(object, 'targetGain', label, `${label}.targetGain`), `${label}.targetGain`),
		gainRampRemaining: requireNumberValue(requireObjectKey(object, 'gainRampRemaining', label, `${label}.gainRampRemaining`), `${label}.gainRampRemaining`),
		stopAfter: requireNumberValue(requireObjectKey(object, 'stopAfter', label, `${label}.stopAfter`), `${label}.stopAfter`),
		filterSampleRate: requireI32(requireObjectKey(object, 'filterSampleRate', label, `${label}.filterSampleRate`), `${label}.filterSampleRate`),
		filter: decodeApuBiquadFilterState(requireObjectKey(object, 'filter', label, `${label}.filter`), `${label}.filter`),
		badp: decodeApuBadpDecoderState(requireObjectKey(object, 'badp', label, `${label}.badp`), `${label}.badp`),
	};
}

function encodeApuOutputState(state: ApuOutputState): ApuOutputState {
	return {
		voices: encodeVector(state.voices, encodeApuOutputVoiceState),
	};
}

function decodeApuOutputState(value: unknown, label: string): ApuOutputState {
	const object = requireObject(value, label);
	return {
		voices: decodeVector(
			requireObjectKey(object, 'voices', label, `${label}.voices`),
			`${label}.voices`,
			(entry) => decodeApuOutputVoiceState(entry, `${label}.voices[]`),
		),
	};
}

function encodeApuCommandFifoState(state: ApuCommandFifoState): ApuCommandFifoState {
	return {
		commands: encodeVector(state.commands, (word) => word >>> 0),
		registerWords: encodeVector(state.registerWords, (word) => word >>> 0),
		readIndex: state.readIndex >>> 0,
		writeIndex: state.writeIndex >>> 0,
		count: state.count >>> 0,
	};
}

function decodeApuCommandFifoState(value: unknown, label: string): ApuCommandFifoState {
	const object = requireObject(value, label);
	return {
		commands: decodeU32FixedArray(requireObjectKey(object, 'commands', label, 'machine.audio.commandFifo.commands'), 'machine.audio.commandFifo.commands', APU_COMMAND_FIFO_CAPACITY),
		registerWords: decodeU32FixedArray(requireObjectKey(object, 'registerWords', label, 'machine.audio.commandFifo.registerWords'), 'machine.audio.commandFifo.registerWords', APU_COMMAND_FIFO_REGISTER_WORD_COUNT),
		readIndex: requireBoundedU32(requireObjectKey(object, 'readIndex', label, 'machine.audio.commandFifo.readIndex'), 'machine.audio.commandFifo.readIndex', 0, APU_COMMAND_FIFO_CAPACITY - 1),
		writeIndex: requireBoundedU32(requireObjectKey(object, 'writeIndex', label, 'machine.audio.commandFifo.writeIndex'), 'machine.audio.commandFifo.writeIndex', 0, APU_COMMAND_FIFO_CAPACITY - 1),
		count: requireBoundedU32(requireObjectKey(object, 'count', label, 'machine.audio.commandFifo.count'), 'machine.audio.commandFifo.count', 0, APU_COMMAND_FIFO_CAPACITY),
	};
}

function encodeAudioControllerState(state: AudioControllerState): AudioControllerState {
	return {
		registerWords: encodeVector(state.registerWords, (word) => word >>> 0),
		commandFifo: encodeApuCommandFifoState(state.commandFifo),
		eventSequence: state.eventSequence,
		eventKind: state.eventKind,
		eventSlot: state.eventSlot,
		eventSourceAddr: state.eventSourceAddr,
		slotPhases: encodeVector(state.slotPhases, (phase) => phase >>> 0),
		slotRegisterWords: encodeVector(state.slotRegisterWords, (word) => word >>> 0),
		slotSourceBytes: encodeVector(state.slotSourceBytes, (bytes) => bytes),
		slotPlaybackCursorQ16: encodeVector(state.slotPlaybackCursorQ16, (word) => word),
		slotFadeSamplesRemaining: encodeVector(state.slotFadeSamplesRemaining, (word) => word >>> 0),
		slotFadeSamplesTotal: encodeVector(state.slotFadeSamplesTotal, (word) => word >>> 0),
		output: encodeApuOutputState(state.output),
		sampleCarry: state.sampleCarry,
		availableSamples: state.availableSamples,
		apuStatus: state.apuStatus,
		apuFaultCode: state.apuFaultCode,
		apuFaultDetail: state.apuFaultDetail,
	};
}

function decodeAudioControllerState(value: unknown, label: string): AudioControllerState {
	const object = requireObject(value, label);
	return {
		registerWords: decodeU32FixedArray(requireObjectKey(object, 'registerWords', label, 'machine.audio.registerWords'), 'machine.audio.registerWords', APU_PARAMETER_REGISTER_COUNT),
		commandFifo: decodeApuCommandFifoState(requireObjectKey(object, 'commandFifo', label, 'machine.audio.commandFifo'), 'machine.audio.commandFifo'),
		eventSequence: requireBoundedU32(requireObjectKey(object, 'eventSequence', label, 'machine.audio.eventSequence'), 'machine.audio.eventSequence', 0, 0xffffffff),
		eventKind: requireBoundedU32(requireObjectKey(object, 'eventKind', label, 'machine.audio.eventKind'), 'machine.audio.eventKind', 0, 0xffffffff),
		eventSlot: requireBoundedU32(requireObjectKey(object, 'eventSlot', label, 'machine.audio.eventSlot'), 'machine.audio.eventSlot', 0, 0xffffffff),
		eventSourceAddr: requireBoundedU32(requireObjectKey(object, 'eventSourceAddr', label, 'machine.audio.eventSourceAddr'), 'machine.audio.eventSourceAddr', 0, 0xffffffff),
		slotPhases: decodeU32FixedArray(requireObjectKey(object, 'slotPhases', label, 'machine.audio.slotPhases'), 'machine.audio.slotPhases', APU_SLOT_COUNT),
		slotRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'slotRegisterWords', label, 'machine.audio.slotRegisterWords'), 'machine.audio.slotRegisterWords', APU_SLOT_REGISTER_WORD_COUNT),
		slotSourceBytes: decodeBinaryFixedArray(requireObjectKey(object, 'slotSourceBytes', label, 'machine.audio.slotSourceBytes'), 'machine.audio.slotSourceBytes', APU_SLOT_COUNT),
		slotPlaybackCursorQ16: decodeIntegerFixedArray(requireObjectKey(object, 'slotPlaybackCursorQ16', label, 'machine.audio.slotPlaybackCursorQ16'), 'machine.audio.slotPlaybackCursorQ16', APU_SLOT_COUNT, 'i64', requireI64),
		slotFadeSamplesRemaining: decodeU32FixedArray(requireObjectKey(object, 'slotFadeSamplesRemaining', label, 'machine.audio.slotFadeSamplesRemaining'), 'machine.audio.slotFadeSamplesRemaining', APU_SLOT_COUNT),
		slotFadeSamplesTotal: decodeU32FixedArray(requireObjectKey(object, 'slotFadeSamplesTotal', label, 'machine.audio.slotFadeSamplesTotal'), 'machine.audio.slotFadeSamplesTotal', APU_SLOT_COUNT),
		output: decodeApuOutputState(requireObjectKey(object, 'output', label, 'machine.audio.output'), 'machine.audio.output'),
		sampleCarry: requireI64(requireObjectKey(object, 'sampleCarry', label, 'machine.audio.sampleCarry'), 'machine.audio.sampleCarry'),
		availableSamples: requireI64(requireObjectKey(object, 'availableSamples', label, 'machine.audio.availableSamples'), 'machine.audio.availableSamples'),
		apuStatus: requireBoundedU32(requireObjectKey(object, 'apuStatus', label, 'machine.audio.apuStatus'), 'machine.audio.apuStatus', 0, 0xffffffff),
		apuFaultCode: requireBoundedU32(requireObjectKey(object, 'apuFaultCode', label, 'machine.audio.apuFaultCode'), 'machine.audio.apuFaultCode', 0, 0xffffffff),
		apuFaultDetail: requireBoundedU32(requireObjectKey(object, 'apuFaultDetail', label, 'machine.audio.apuFaultDetail'), 'machine.audio.apuFaultDetail', 0, 0xffffffff),
	};
}

function encodeDmaJobState(state: DmaJobState): DmaJobState {
	return {
		src: state.src,
		dst: state.dst,
		remaining: state.remaining,
		written: state.written,
		clipped: state.clipped,
	};
}

function decodeDmaJobState(value: unknown, label: string): DmaJobState {
	const object = requireObject(value, label);
	return {
		src: requireBoundedU32(requireObjectKey(object, 'src', label, `${label}.src`), `${label}.src`, 0, 0xffffffff),
		dst: requireBoundedU32(requireObjectKey(object, 'dst', label, `${label}.dst`), `${label}.dst`, 0, 0xffffffff),
		remaining: requireBoundedU32(requireObjectKey(object, 'remaining', label, `${label}.remaining`), `${label}.remaining`, 0, 0xffffffff),
		written: requireBoundedU32(requireObjectKey(object, 'written', label, `${label}.written`), `${label}.written`, 0, 0xffffffff),
		clipped: requireBooleanValue(requireObjectKey(object, 'clipped', label, `${label}.clipped`), `${label}.clipped`),
	};
}

function encodeDmaControllerState(state: DmaControllerState): DmaControllerState {
	return {
		queue: encodeVector(state.queue, encodeDmaJobState),
		budget: state.budget,
		carry: state.carry,
		writtenValue: state.writtenValue,
		writtenDirty: state.writtenDirty,
		sourceRegisterWord: state.sourceRegisterWord,
		destinationRegisterWord: state.destinationRegisterWord,
		lengthRegisterWord: state.lengthRegisterWord,
		controlRegisterWord: state.controlRegisterWord,
		statusRegisterWord: state.statusRegisterWord,
		writtenRegisterWord: state.writtenRegisterWord,
	};
}

function decodeDmaControllerState(value: unknown, label: string): DmaControllerState {
	const object = requireObject(value, label);
	const queueEntries = requireArray(requireObjectKey(object, 'queue', label, `${label}.queue`), `${label}.queue`);
	if (queueEntries.length > DMA_JOB_QUEUE_CAPACITY) {
		throw new Error(`${label}.queue exceeds the ${DMA_JOB_QUEUE_CAPACITY}-job DMA FIFO capacity.`);
	}
	const queue = new Array<DmaJobState>(queueEntries.length);
	for (let index = 0; index < queueEntries.length; index += 1) {
		queue[index] = decodeDmaJobState(queueEntries[index], `${label}.queue[${index}]`);
	}
	return {
		queue,
		budget: requireI64(requireObjectKey(object, 'budget', label, `${label}.budget`), `${label}.budget`),
		carry: requireI64(requireObjectKey(object, 'carry', label, `${label}.carry`), `${label}.carry`),
		writtenValue: requireBoundedU32(requireObjectKey(object, 'writtenValue', label, `${label}.writtenValue`), `${label}.writtenValue`, 0, 0xffffffff),
		writtenDirty: requireBooleanValue(requireObjectKey(object, 'writtenDirty', label, `${label}.writtenDirty`), `${label}.writtenDirty`),
		sourceRegisterWord: requireBoundedU32(requireObjectKey(object, 'sourceRegisterWord', label, `${label}.sourceRegisterWord`), `${label}.sourceRegisterWord`, 0, 0xffffffff),
		destinationRegisterWord: requireBoundedU32(requireObjectKey(object, 'destinationRegisterWord', label, `${label}.destinationRegisterWord`), `${label}.destinationRegisterWord`, 0, 0xffffffff),
		lengthRegisterWord: requireBoundedU32(requireObjectKey(object, 'lengthRegisterWord', label, `${label}.lengthRegisterWord`), `${label}.lengthRegisterWord`, 0, 0xffffffff),
		controlRegisterWord: requireBoundedU32(requireObjectKey(object, 'controlRegisterWord', label, `${label}.controlRegisterWord`), `${label}.controlRegisterWord`, 0, 0xffffffff),
		statusRegisterWord: requireBoundedU32(requireObjectKey(object, 'statusRegisterWord', label, `${label}.statusRegisterWord`), `${label}.statusRegisterWord`, 0, 0xffffffff),
		writtenRegisterWord: requireBoundedU32(requireObjectKey(object, 'writtenRegisterWord', label, `${label}.writtenRegisterWord`), `${label}.writtenRegisterWord`, 0, 0xffffffff),
	};
}

function encodeMachineSaveState(state: MachineSaveState): MachineSaveState {
	return {
		memory: encodeMemorySaveState(state.memory),
		dma: encodeDmaControllerState(state.dma),
		geometry: encodeGeometryControllerState(state.geometry),
		gxGpu: encodeGxGpuSaveState(state.gxGpu),
		gxGte: encodeGxGteState(state.gxGte),
		irq: encodeIrqControllerState(state.irq),
		audio: encodeAudioControllerState(state.audio),
		stringPool: encodeStringPoolState(state.stringPool),
		input: encodeInputControllerState(state.input),
	};
}

function decodeMachineSaveState(value: unknown, label: string): MachineSaveState {
	const object = requireObject(value, label);
	return {
		memory: decodeMemorySaveState(requireObjectKey(object, 'memory', label, 'machineState.machine.memory'), 'machineState.machine.memory'),
		dma: decodeDmaControllerState(requireObjectKey(object, 'dma', label, 'machineState.machine.dma'), 'machineState.machine.dma'),
		geometry: decodeGeometryControllerState(requireObjectKey(object, 'geometry', label, 'machineState.machine.geometry'), 'machineState.machine.geometry'),
		gxGpu: decodeGxGpuSaveState(requireObjectKey(object, 'gxGpu', label, 'machineState.machine.gxGpu'), 'machineState.machine.gxGpu'),
		gxGte: decodeGxGteState(requireObjectKey(object, 'gxGte', label, 'machineState.machine.gxGte'), 'machineState.machine.gxGte'),
		irq: decodeIrqControllerState(requireObjectKey(object, 'irq', label, 'machineState.machine.irq'), 'machineState.machine.irq'),
		audio: decodeAudioControllerState(requireObjectKey(object, 'audio', label, 'machineState.machine.audio'), 'machineState.machine.audio'),
		stringPool: decodeStringPoolState(requireObjectKey(object, 'stringPool', label, 'machineState.machine.stringPool'), 'machineState.machine.stringPool'),
		input: decodeInputControllerState(requireObjectKey(object, 'input', label, 'machineState.machine.input'), 'machineState.machine.input'),
	};
}

function encodeRuntimeSaveMachineState(state: RuntimeSaveMachineState): RuntimeSaveMachineState {
	return {
		psxGpuDisplayModeWord: state.psxGpuDisplayModeWord,
		machine: encodeMachineSaveState(state.machine),
		frameScheduler: encodeFrameSchedulerState(state.frameScheduler),
		vblank: encodeRuntimeVblankState(state.vblank),
	};
}

function decodeRuntimeSaveMachineState(value: unknown, label: string): RuntimeSaveMachineState {
	const object = requireObject(value, label);
	return {
		psxGpuDisplayModeWord: requireObjectKey(object, 'psxGpuDisplayModeWord', label, 'machineState.psxGpuDisplayModeWord') as number,
		machine: decodeMachineSaveState(requireObjectKey(object, 'machine', label, 'machineState.machine'), 'machineState.machine'),
		frameScheduler: decodeFrameSchedulerState(requireObjectKey(object, 'frameScheduler', label, 'machineState.frameScheduler'), 'machineState.frameScheduler'),
		vblank: decodeRuntimeVblankState(requireObjectKey(object, 'vblank', label, 'machineState.vblank'), 'machineState.vblank'),
	};
}

function encodeCpuValueState(state: CpuValueState): CpuValueState {
	switch (state.tag) {
		case 'nil':
		case 'false':
		case 'true':
			return { tag: state.tag };
		case 'number':
			return { tag: 'number', value: state.value };
		case 'string':
			return { tag: 'string', id: state.id };
		case 'builtin':
			return { tag: 'builtin', id: state.id };
		case 'ref':
			return { tag: 'ref', id: state.id };
	}
}

function decodeCpuValueState(value: unknown, label: string): CpuValueState {
	const object = requireObject(value, label);
	const tag = requireObjectKey(object, 'tag', label, 'cpuValueState.tag') as CpuValueState['tag'];
	switch (tag) {
		case 'nil':
		case 'false':
		case 'true':
			return { tag };
		case 'number':
			return { tag: 'number', value: requireObjectKey(object, 'value', label, 'cpuValueState.value') as number };
		case 'string':
			return { tag: 'string', id: requireObjectKey(object, 'id', label, 'cpuValueState.id') as number };
		case 'builtin':
			return { tag: 'builtin', id: requireObjectKey(object, 'id', label, 'cpuValueState.id') as BuiltinFunctionId };
		case 'ref':
			return { tag: 'ref', id: requireObjectKey(object, 'id', label, 'cpuValueState.id') as number };
	}
	throw new Error('cpuValueState.tag is invalid.');
}

function encodeCpuTableHashNodeState(state: CpuTableHashNodeState): CpuTableHashNodeState {
	return {
		key: encodeCpuValueState(state.key),
		value: encodeCpuValueState(state.value),
		next: state.next,
	};
}

function decodeCpuTableHashNodeState(value: unknown, label: string): CpuTableHashNodeState {
	const object = requireObject(value, label);
	return {
		key: decodeCpuValueState(requireObjectKey(object, 'key', label, 'cpuObjectState.hash[].key'), 'cpuObjectState.hash[].key'),
		value: decodeCpuValueState(requireObjectKey(object, 'value', label, 'cpuObjectState.hash[].value'), 'cpuObjectState.hash[].value'),
		next: requireObjectKey(object, 'next', label, 'cpuObjectState.hash[].next') as number,
	};
}

function encodeCpuObjectState(state: CpuObjectState): CpuObjectState {
	switch (state.kind) {
		case 'table':
			return {
				kind: 'table',
				hashId: state.hashId,
				array: encodeVector(state.array, encodeCpuValueState),
				arrayLength: state.arrayLength,
				hash: encodeVector(state.hash, encodeCpuTableHashNodeState),
				hashFree: state.hashFree,
				metatable: encodeCpuValueState(state.metatable),
			};
		case 'closure':
			return {
				kind: 'closure',
				hashId: state.hashId,
				protoIndex: state.protoIndex,
				upvalues: encodeVector(state.upvalues, (index) => index),
			};
		case 'upvalue':
			return {
				kind: 'upvalue',
				hashId: state.hashId,
				open: state.open,
				index: state.index,
				frameIndex: state.frameIndex,
				value: encodeCpuValueState(state.value),
			};
	}
}

function decodeCpuObjectState(value: unknown, label: string): CpuObjectState {
	const object = requireObject(value, label);
	const kind = requireObjectKey(object, 'kind', label, 'cpuObjectState.kind') as CpuObjectState['kind'];
	switch (kind) {
		case 'table':
			return {
				kind: 'table',
				hashId: requireObjectKey(object, 'hashId', label, 'cpuObjectState.hashId') as number,
				array: decodeVector(
					requireObjectKey(object, 'array', label, 'cpuObjectState.array'),
					'cpuObjectState.array',
					(entry) => decodeCpuValueState(entry, 'cpuObjectState.array[]'),
				),
				arrayLength: requireObjectKey(object, 'arrayLength', label, 'cpuObjectState.arrayLength') as number,
				hash: decodeVector(
					requireObjectKey(object, 'hash', label, 'cpuObjectState.hash'),
					'cpuObjectState.hash',
					(entry) => decodeCpuTableHashNodeState(entry, 'cpuObjectState.hash[]'),
				),
				hashFree: requireObjectKey(object, 'hashFree', label, 'cpuObjectState.hashFree') as number,
				metatable: decodeCpuValueState(requireObjectKey(object, 'metatable', label, 'cpuObjectState.metatable'), 'cpuObjectState.metatable'),
			};
		case 'closure':
			return {
				kind: 'closure',
				hashId: requireObjectKey(object, 'hashId', label, 'cpuObjectState.hashId') as number,
				protoIndex: requireObjectKey(object, 'protoIndex', label, 'cpuObjectState.protoIndex') as number,
				upvalues: decodeVector(
					requireObjectKey(object, 'upvalues', label, 'cpuObjectState.upvalues'),
					'cpuObjectState.upvalues',
					(entry) => entry as number,
				),
			};
		case 'upvalue':
			return {
				kind: 'upvalue',
				hashId: requireObjectKey(object, 'hashId', label, 'cpuObjectState.hashId') as number,
				open: requireObjectKey(object, 'open', label, 'cpuObjectState.open') as boolean,
				index: requireObjectKey(object, 'index', label, 'cpuObjectState.index') as number,
				frameIndex: requireObjectKey(object, 'frameIndex', label, 'cpuObjectState.frameIndex') as number,
				value: decodeCpuValueState(requireObjectKey(object, 'value', label, 'cpuObjectState.value'), 'cpuObjectState.value'),
			};
	}
	throw new Error('cpuObjectState.kind is invalid.');
}

function encodeCpuFrameState(state: CpuFrameState): CpuFrameState {
	return {
		protoIndex: state.protoIndex,
		pc: state.pc,
		closureRef: state.closureRef,
		registers: encodeVector(state.registers, encodeCpuValueState),
		varargs: encodeVector(state.varargs, encodeCpuValueState),
		returnBase: state.returnBase,
		returnCount: state.returnCount,
		top: state.top,
		captureReturns: state.captureReturns,
		callSitePc: state.callSitePc,
		isInterruptFrame: state.isInterruptFrame,
		savedMaskableEnabled: state.savedMaskableEnabled,
	};
}

function decodeCpuFrameState(value: unknown, label: string): CpuFrameState {
	const object = requireObject(value, label);
	return {
		protoIndex: requireObjectKey(object, 'protoIndex', label, 'cpuFrameState.protoIndex') as number,
		pc: requireObjectKey(object, 'pc', label, 'cpuFrameState.pc') as number,
		closureRef: requireObjectKey(object, 'closureRef', label, 'cpuFrameState.closureRef') as number,
		registers: decodeVector(
			requireObjectKey(object, 'registers', label, 'cpuFrameState.registers'),
			'cpuFrameState.registers',
			(entry) => decodeCpuValueState(entry, 'cpuFrameState.registers[]'),
		),
		varargs: decodeVector(
			requireObjectKey(object, 'varargs', label, 'cpuFrameState.varargs'),
			'cpuFrameState.varargs',
			(entry) => decodeCpuValueState(entry, 'cpuFrameState.varargs[]'),
		),
		returnBase: requireObjectKey(object, 'returnBase', label, 'cpuFrameState.returnBase') as number,
		returnCount: requireObjectKey(object, 'returnCount', label, 'cpuFrameState.returnCount') as number,
		top: requireObjectKey(object, 'top', label, 'cpuFrameState.top') as number,
		captureReturns: requireObjectKey(object, 'captureReturns', label, 'cpuFrameState.captureReturns') as boolean,
		callSitePc: requireObjectKey(object, 'callSitePc', label, 'cpuFrameState.callSitePc') as number,
		isInterruptFrame: requireObjectKey(object, 'isInterruptFrame', label, 'cpuFrameState.isInterruptFrame') as boolean,
		savedMaskableEnabled: requireObjectKey(object, 'savedMaskableEnabled', label, 'cpuFrameState.savedMaskableEnabled') as boolean,
	};
}

function encodeCpuRootValueState(state: CpuRootValueState): CpuRootValueState {
	return {
		name: state.name,
		value: encodeCpuValueState(state.value),
	};
}

function decodeCpuRootValueState(value: unknown, label: string): CpuRootValueState {
	const object = requireObject(value, label);
	return {
		name: requireObjectKey(object, 'name', label, 'cpuRootValueState.name') as string,
		value: decodeCpuValueState(requireObjectKey(object, 'value', label, 'cpuRootValueState.value'), 'cpuRootValueState.value'),
	};
}

function encodeCpuRuntimeState(state: CpuRuntimeState): CpuRuntimeState {
	return {
		globals: encodeVector(state.globals, encodeCpuRootValueState),
		moduleCache: encodeVector(state.moduleCache, encodeCpuRootValueState),
		frames: encodeVector(state.frames, encodeCpuFrameState),
		lastReturnValues: encodeVector(state.lastReturnValues, encodeCpuValueState),
		objects: encodeVector(state.objects, encodeCpuObjectState),
		openUpvalues: encodeVector(state.openUpvalues, (value) => value),
		lastPc: state.lastPc,
		lastInstruction: state.lastInstruction,
		instructionBudgetRemaining: state.instructionBudgetRemaining,
		haltedUntilIrq: state.haltedUntilIrq,
		maskableInterruptsEnabled: state.maskableInterruptsEnabled,
		maskableInterruptsRestoreEnabled: state.maskableInterruptsRestoreEnabled,
		nonMaskableInterruptPending: state.nonMaskableInterruptPending,
		yieldRequested: state.yieldRequested,
	};
}

function decodeCpuRuntimeState(value: unknown, label: string): CpuRuntimeState {
	const object = requireObject(value, label);
	return {
		globals: decodeVector(
			requireObjectKey(object, 'globals', label, 'cpuState.globals'),
			'cpuState.globals',
			(entry) => decodeCpuRootValueState(entry, 'cpuState.globals[]'),
		),
		moduleCache: decodeVector(
			requireObjectKey(object, 'moduleCache', label, 'cpuState.moduleCache'),
			'cpuState.moduleCache',
			(entry) => decodeCpuRootValueState(entry, 'cpuState.moduleCache[]'),
		),
		frames: decodeVector(
			requireObjectKey(object, 'frames', label, 'cpuState.frames'),
			'cpuState.frames',
			(entry) => decodeCpuFrameState(entry, 'cpuState.frames[]'),
		),
		lastReturnValues: decodeVector(
			requireObjectKey(object, 'lastReturnValues', label, 'cpuState.lastReturnValues'),
			'cpuState.lastReturnValues',
			(entry) => decodeCpuValueState(entry, 'cpuState.lastReturnValues[]'),
		),
		objects: decodeVector(
			requireObjectKey(object, 'objects', label, 'cpuState.objects'),
			'cpuState.objects',
			(entry) => decodeCpuObjectState(entry, 'cpuState.objects[]'),
		),
		openUpvalues: decodeVector(
			requireObjectKey(object, 'openUpvalues', label, 'cpuState.openUpvalues'),
			'cpuState.openUpvalues',
			(entry) => entry as number,
		),
		lastPc: requireObjectKey(object, 'lastPc', label, 'cpuState.lastPc') as number,
		lastInstruction: requireObjectKey(object, 'lastInstruction', label, 'cpuState.lastInstruction') as number,
		instructionBudgetRemaining: requireObjectKey(object, 'instructionBudgetRemaining', label, 'cpuState.instructionBudgetRemaining') as number,
		haltedUntilIrq: requireObjectKey(object, 'haltedUntilIrq', label, 'cpuState.haltedUntilIrq') as boolean,
		maskableInterruptsEnabled: requireObjectKey(object, 'maskableInterruptsEnabled', label, 'cpuState.maskableInterruptsEnabled') as boolean,
		maskableInterruptsRestoreEnabled: requireObjectKey(object, 'maskableInterruptsRestoreEnabled', label, 'cpuState.maskableInterruptsRestoreEnabled') as boolean,
		nonMaskableInterruptPending: requireObjectKey(object, 'nonMaskableInterruptPending', label, 'cpuState.nonMaskableInterruptPending') as boolean,
		yieldRequested: requireObjectKey(object, 'yieldRequested', label, 'cpuState.yieldRequested') as boolean,
	};
}

function encodeRuntimeSaveStateValue(state: RuntimeSaveState): RuntimeSaveState {
	return {
		machineState: encodeRuntimeSaveMachineState(state.machineState),
		cpuState: encodeCpuRuntimeState(state.cpuState),
		systemProgramActive: state.systemProgramActive,
		luaInitialized: state.luaInitialized,
		luaRuntimeFailed: state.luaRuntimeFailed,
		pendingEntryCall: state.pendingEntryCall,
	};
}

function decodeRuntimeSaveStateValue(value: unknown, label: string): RuntimeSaveState {
	const object = requireObject(value, label);
	return {
		machineState: decodeRuntimeSaveMachineState(requireObjectKey(object, 'machineState', label, 'runtimeSaveState.machineState'), 'runtimeSaveState.machineState'),
		cpuState: decodeCpuRuntimeState(requireObjectKey(object, 'cpuState', label, 'runtimeSaveState.cpuState'), 'runtimeSaveState.cpuState'),
		systemProgramActive: requireObjectKey(object, 'systemProgramActive', label, 'runtimeSaveState.systemProgramActive') as boolean,
		luaInitialized: requireObjectKey(object, 'luaInitialized', label, 'runtimeSaveState.luaInitialized') as boolean,
		luaRuntimeFailed: requireObjectKey(object, 'luaRuntimeFailed', label, 'runtimeSaveState.luaRuntimeFailed') as boolean,
		pendingEntryCall: requireObjectKey(object, 'pendingEntryCall', label, 'runtimeSaveState.pendingEntryCall') as boolean,
	};
}

export function encodeRuntimeSaveState(state: RuntimeSaveState): Uint8Array {
	return encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
}

export function decodeRuntimeSaveState(bytes: Uint8Array): RuntimeSaveState {
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(bytes, RUNTIME_SAVE_STATE_PROP_NAMES),
		'runtimeSaveState',
	);
}

export function captureRuntimeSaveStateBytes(runtime: Runtime): Uint8Array {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

export function applyRuntimeSaveStateBytes(runtime: Runtime, bytes: Uint8Array): void {
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes));
}
