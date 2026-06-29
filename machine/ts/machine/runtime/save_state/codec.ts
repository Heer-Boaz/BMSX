import { decodeBinaryWithPropTable, encodeBinaryWithPropTable, requireObject, requireObjectKey } from '../../../common/serializer/binencoder';
import type { MachineSaveState } from '../../save_state';
import type { CpuFrameState, CpuObjectState, CpuRootValueState, CpuRuntimeRefSegment, CpuRuntimeState, CpuValueState } from '../../cpu/cpu';
import type { IrqControllerState } from '../../devices/irq/save_state';
import type { AudioControllerState } from '../../devices/audio/save_state';
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
import type { GeometryJobState } from '../../devices/geometry/job';
import type { GeometryControllerState } from '../../devices/geometry/save_state';
import type { VdpSaveState, VdpState } from '../../devices/vdp/save_state';
import type { VdpSurfacePixelsState, VdpVramState } from '../../devices/vdp/vram';
import type { VdpStreamIngressState } from '../../devices/vdp/ingress';
import type { VdpReadbackState } from '../../devices/vdp/readback';
import { VDP_JTU_REGISTER_WORDS, VDP_MFU_WEIGHT_COUNT } from '../../devices/vdp/contracts';
import { VDP_LPU_REGISTER_WORDS } from '../../devices/vdp/lpu';
import {
	VDP_DEX_FRAME_DIRECT_OPEN,
	VDP_DEX_FRAME_IDLE,
	VDP_DEX_FRAME_STREAM_OPEN,
	VDP_SUBMITTED_FRAME_EMPTY,
	VDP_SUBMITTED_FRAME_EXECUTING,
	VDP_SUBMITTED_FRAME_QUEUED,
	VDP_SUBMITTED_FRAME_READY,
	type VdpBuildingFrameSaveState,
	type VdpSubmittedFrameSaveState,
} from '../../devices/vdp/frame';
import { VDP_REGISTER_COUNT } from '../../devices/vdp/registers';
import {
	VDP_RPU_DRAW_CAPACITY,
	VDP_RPU_PASS_CAPACITY,
	VDP_RPU_STREAM_BINDING_CAPACITY,
	VDP_RPU_CONSTANT_BINDING_CAPACITY,
	VDP_RPU_TEXTURE_BINDING_CAPACITY,
	type VdpRpuCommandBufferSaveState,
	type VdpRpuFrameSaveState,
	type VdpRpuSaveState,
} from '../../devices/vdp/rpu';
import { VDP_XF_MATRIX_COUNT, VDP_XF_MATRIX_REGISTER_WORDS, type VdpXfState } from '../../devices/vdp/xf';
import type { MemorySaveState } from '../../memory/memory';
import { VDP_STREAM_CAPACITY_WORDS, VRAM_STAGING_SIZE } from '../../memory/map';
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
		vdpFrameCost: state.vdpFrameCost,
		vdpFrameHeld: state.vdpFrameHeld,
	};
}

function decodeTickCompletion(value: unknown, label: string): TickCompletion {
	const object = requireObject(value, label);
	return {
		sequence: requireObjectKey(object, 'sequence', label, 'tickCompletion.sequence') as number,
		remaining: requireObjectKey(object, 'remaining', label, 'tickCompletion.remaining') as number,
		visualCommitted: requireObjectKey(object, 'visualCommitted', label, 'tickCompletion.visualCommitted') as boolean,
		vdpFrameCost: requireObjectKey(object, 'vdpFrameCost', label, 'tickCompletion.vdpFrameCost') as number,
		vdpFrameHeld: requireObjectKey(object, 'vdpFrameHeld', label, 'tickCompletion.vdpFrameHeld') as boolean,
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
		lastTickVdpFrameCost: state.lastTickVdpFrameCost,
		lastTickVdpFrameHeld: state.lastTickVdpFrameHeld,
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
		lastTickVdpFrameCost: requireObjectKey(object, 'lastTickVdpFrameCost', label, 'frameScheduler.lastTickVdpFrameCost') as number,
		lastTickVdpFrameHeld: requireObjectKey(object, 'lastTickVdpFrameHeld', label, 'frameScheduler.lastTickVdpFrameHeld') as boolean,
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
	return {
		ram: requireBinaryValue(requireObjectKey(object, 'ram', label, 'machine.memory.ram'), 'machine.memory.ram'),
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

function encodeVdpXfState(state: VdpXfState): VdpXfState {
	return {
		matrixWords: state.matrixWords,
		viewMatrixIndex: state.viewMatrixIndex,
		projectionMatrixIndex: state.projectionMatrixIndex,
	};
}

function decodeVdpXfState(value: unknown, label: string): VdpXfState {
	const object = requireObject(value, label);
	return {
		matrixWords: decodeU32FixedArray(requireObjectKey(object, 'matrixWords', label, `${label}.matrixWords`), `${label}.matrixWords`, VDP_XF_MATRIX_REGISTER_WORDS),
		viewMatrixIndex: requireBoundedU32(requireObjectKey(object, 'viewMatrixIndex', label, `${label}.viewMatrixIndex`), `${label}.viewMatrixIndex`, 0, VDP_XF_MATRIX_COUNT - 1),
		projectionMatrixIndex: requireBoundedU32(requireObjectKey(object, 'projectionMatrixIndex', label, `${label}.projectionMatrixIndex`), `${label}.projectionMatrixIndex`, 0, VDP_XF_MATRIX_COUNT - 1),
	};
}

function decodeBoundedU32Vector(value: unknown, label: string, capacity: number): number[] {
	const entries = decodeVector(value, label, (entry) => requireBoundedU32(entry, `${label}[]`, 0, 0xffffffff));
	if (entries.length > capacity) {
		throw new Error(`${label} exceeds capacity ${capacity}.`);
	}
	return entries;
}

function decodeBoundedU16Vector(value: unknown, label: string, capacity: number): number[] {
	const entries = decodeVector(value, label, (entry) => requireBoundedU32(entry, `${label}[]`, 0, 0xffff));
	if (entries.length > capacity) {
		throw new Error(`${label} exceeds capacity ${capacity}.`);
	}
	return entries;
}

function decodeBoundedU8Vector(value: unknown, label: string, capacity: number): number[] {
	const entries = decodeVector(value, label, (entry) => requireBoundedU32(entry, `${label}[]`, 0, 0xff));
	if (entries.length > capacity) {
		throw new Error(`${label} exceeds capacity ${capacity}.`);
	}
	return entries;
}

function requireVectorCount<T>(values: T[], label: string, count: number): T[] {
	if (values.length !== count) {
		throw new Error(`${label} must contain ${count} entries.`);
	}
	return values;
}

function encodeVdpRpuCommandBufferState(state: VdpRpuCommandBufferSaveState): VdpRpuCommandBufferSaveState {
	return {
		passCount: state.passCount,
		drawCount: state.drawCount,
		streamBindingCount: state.streamBindingCount,
		constantBindingCount: state.constantBindingCount,
		textureBindingCount: state.textureBindingCount,
		passFirstDraw: state.passFirstDraw,
		passDrawCount: state.passDrawCount,
		passColorSurfaceDescAddr: state.passColorSurfaceDescAddr,
		passDepthSurfaceDescAddr: state.passDepthSurfaceDescAddr,
		passViewportXY: state.passViewportXY,
		passViewportWH: state.passViewportWH,
		passOps: state.passOps,
		passClearColor: state.passClearColor,
		passClearDepthWord: state.passClearDepthWord,
		drawShaderVariant: state.drawShaderVariant,
		drawPrimitive: state.drawPrimitive,
		drawPipelineWord: state.drawPipelineWord,
		drawVertexCount: state.drawVertexCount,
		drawInstanceCount: state.drawInstanceCount,
		drawIndexVramAddr: state.drawIndexVramAddr,
		drawIndexCount: state.drawIndexCount,
		drawIndexType: state.drawIndexType,
		drawFirstStreamBinding: state.drawFirstStreamBinding,
		drawStreamBindingCount: state.drawStreamBindingCount,
		drawFirstConstantBinding: state.drawFirstConstantBinding,
		drawConstantBindingCount: state.drawConstantBindingCount,
		drawFirstTextureBinding: state.drawFirstTextureBinding,
		drawTextureBindingCount: state.drawTextureBindingCount,
		streamLayoutId: state.streamLayoutId,
		streamSlot: state.streamSlot,
		streamVramAddr: state.streamVramAddr,
		streamByteLength: state.streamByteLength,
		streamStepRate: state.streamStepRate,
		constantBindingSlot: state.constantBindingSlot,
		constantVramAddr: state.constantVramAddr,
		constantByteLength: state.constantByteLength,
		textureSlot: state.textureSlot,
		textureSurfaceDescAddr: state.textureSurfaceDescAddr,
	};
}

function decodeVdpRpuCommandBufferState(value: unknown, label: string): VdpRpuCommandBufferSaveState {
	const object = requireObject(value, label);
	const passCount = requireBoundedU32(requireObjectKey(object, 'passCount', label, `${label}.passCount`), `${label}.passCount`, 0, VDP_RPU_PASS_CAPACITY);
	const drawCount = requireBoundedU32(requireObjectKey(object, 'drawCount', label, `${label}.drawCount`), `${label}.drawCount`, 0, VDP_RPU_DRAW_CAPACITY);
	const streamBindingCount = requireBoundedU32(requireObjectKey(object, 'streamBindingCount', label, `${label}.streamBindingCount`), `${label}.streamBindingCount`, 0, VDP_RPU_STREAM_BINDING_CAPACITY);
	const constantBindingCount = requireBoundedU32(requireObjectKey(object, 'constantBindingCount', label, `${label}.constantBindingCount`), `${label}.constantBindingCount`, 0, VDP_RPU_CONSTANT_BINDING_CAPACITY);
	const textureBindingCount = requireBoundedU32(requireObjectKey(object, 'textureBindingCount', label, `${label}.textureBindingCount`), `${label}.textureBindingCount`, 0, VDP_RPU_TEXTURE_BINDING_CAPACITY);
	return {
		passCount,
		drawCount,
		streamBindingCount,
		constantBindingCount,
		textureBindingCount,
		passFirstDraw: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passFirstDraw', label, `${label}.passFirstDraw`), `${label}.passFirstDraw`, VDP_RPU_PASS_CAPACITY), `${label}.passFirstDraw`, passCount),
		passDrawCount: requireVectorCount(decodeBoundedU16Vector(requireObjectKey(object, 'passDrawCount', label, `${label}.passDrawCount`), `${label}.passDrawCount`, VDP_RPU_PASS_CAPACITY), `${label}.passDrawCount`, passCount),
		passColorSurfaceDescAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passColorSurfaceDescAddr', label, `${label}.passColorSurfaceDescAddr`), `${label}.passColorSurfaceDescAddr`, VDP_RPU_PASS_CAPACITY), `${label}.passColorSurfaceDescAddr`, passCount),
		passDepthSurfaceDescAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passDepthSurfaceDescAddr', label, `${label}.passDepthSurfaceDescAddr`), `${label}.passDepthSurfaceDescAddr`, VDP_RPU_PASS_CAPACITY), `${label}.passDepthSurfaceDescAddr`, passCount),
		passViewportXY: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passViewportXY', label, `${label}.passViewportXY`), `${label}.passViewportXY`, VDP_RPU_PASS_CAPACITY), `${label}.passViewportXY`, passCount),
		passViewportWH: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passViewportWH', label, `${label}.passViewportWH`), `${label}.passViewportWH`, VDP_RPU_PASS_CAPACITY), `${label}.passViewportWH`, passCount),
		passOps: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passOps', label, `${label}.passOps`), `${label}.passOps`, VDP_RPU_PASS_CAPACITY), `${label}.passOps`, passCount),
		passClearColor: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passClearColor', label, `${label}.passClearColor`), `${label}.passClearColor`, VDP_RPU_PASS_CAPACITY), `${label}.passClearColor`, passCount),
		passClearDepthWord: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'passClearDepthWord', label, `${label}.passClearDepthWord`), `${label}.passClearDepthWord`, VDP_RPU_PASS_CAPACITY), `${label}.passClearDepthWord`, passCount),
		drawShaderVariant: requireVectorCount(decodeBoundedU16Vector(requireObjectKey(object, 'drawShaderVariant', label, `${label}.drawShaderVariant`), `${label}.drawShaderVariant`, VDP_RPU_DRAW_CAPACITY), `${label}.drawShaderVariant`, drawCount),
		drawPrimitive: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'drawPrimitive', label, `${label}.drawPrimitive`), `${label}.drawPrimitive`, VDP_RPU_DRAW_CAPACITY), `${label}.drawPrimitive`, drawCount),
		drawPipelineWord: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawPipelineWord', label, `${label}.drawPipelineWord`), `${label}.drawPipelineWord`, VDP_RPU_DRAW_CAPACITY), `${label}.drawPipelineWord`, drawCount),
		drawVertexCount: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawVertexCount', label, `${label}.drawVertexCount`), `${label}.drawVertexCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawVertexCount`, drawCount),
		drawInstanceCount: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawInstanceCount', label, `${label}.drawInstanceCount`), `${label}.drawInstanceCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawInstanceCount`, drawCount),
		drawIndexVramAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawIndexVramAddr', label, `${label}.drawIndexVramAddr`), `${label}.drawIndexVramAddr`, VDP_RPU_DRAW_CAPACITY), `${label}.drawIndexVramAddr`, drawCount),
		drawIndexCount: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawIndexCount', label, `${label}.drawIndexCount`), `${label}.drawIndexCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawIndexCount`, drawCount),
		drawIndexType: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'drawIndexType', label, `${label}.drawIndexType`), `${label}.drawIndexType`, VDP_RPU_DRAW_CAPACITY), `${label}.drawIndexType`, drawCount),
		drawFirstStreamBinding: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawFirstStreamBinding', label, `${label}.drawFirstStreamBinding`), `${label}.drawFirstStreamBinding`, VDP_RPU_DRAW_CAPACITY), `${label}.drawFirstStreamBinding`, drawCount),
		drawStreamBindingCount: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'drawStreamBindingCount', label, `${label}.drawStreamBindingCount`), `${label}.drawStreamBindingCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawStreamBindingCount`, drawCount),
		drawFirstConstantBinding: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawFirstConstantBinding', label, `${label}.drawFirstConstantBinding`), `${label}.drawFirstConstantBinding`, VDP_RPU_DRAW_CAPACITY), `${label}.drawFirstConstantBinding`, drawCount),
		drawConstantBindingCount: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'drawConstantBindingCount', label, `${label}.drawConstantBindingCount`), `${label}.drawConstantBindingCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawConstantBindingCount`, drawCount),
		drawFirstTextureBinding: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'drawFirstTextureBinding', label, `${label}.drawFirstTextureBinding`), `${label}.drawFirstTextureBinding`, VDP_RPU_DRAW_CAPACITY), `${label}.drawFirstTextureBinding`, drawCount),
		drawTextureBindingCount: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'drawTextureBindingCount', label, `${label}.drawTextureBindingCount`), `${label}.drawTextureBindingCount`, VDP_RPU_DRAW_CAPACITY), `${label}.drawTextureBindingCount`, drawCount),
		streamLayoutId: requireVectorCount(decodeBoundedU16Vector(requireObjectKey(object, 'streamLayoutId', label, `${label}.streamLayoutId`), `${label}.streamLayoutId`, VDP_RPU_STREAM_BINDING_CAPACITY), `${label}.streamLayoutId`, streamBindingCount),
		streamSlot: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'streamSlot', label, `${label}.streamSlot`), `${label}.streamSlot`, VDP_RPU_STREAM_BINDING_CAPACITY), `${label}.streamSlot`, streamBindingCount),
		streamVramAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'streamVramAddr', label, `${label}.streamVramAddr`), `${label}.streamVramAddr`, VDP_RPU_STREAM_BINDING_CAPACITY), `${label}.streamVramAddr`, streamBindingCount),
		streamByteLength: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'streamByteLength', label, `${label}.streamByteLength`), `${label}.streamByteLength`, VDP_RPU_STREAM_BINDING_CAPACITY), `${label}.streamByteLength`, streamBindingCount),
		streamStepRate: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'streamStepRate', label, `${label}.streamStepRate`), `${label}.streamStepRate`, VDP_RPU_STREAM_BINDING_CAPACITY), `${label}.streamStepRate`, streamBindingCount),
		constantBindingSlot: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'constantBindingSlot', label, `${label}.constantBindingSlot`), `${label}.constantBindingSlot`, VDP_RPU_CONSTANT_BINDING_CAPACITY), `${label}.constantBindingSlot`, constantBindingCount),
		constantVramAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'constantVramAddr', label, `${label}.constantVramAddr`), `${label}.constantVramAddr`, VDP_RPU_CONSTANT_BINDING_CAPACITY), `${label}.constantVramAddr`, constantBindingCount),
		constantByteLength: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'constantByteLength', label, `${label}.constantByteLength`), `${label}.constantByteLength`, VDP_RPU_CONSTANT_BINDING_CAPACITY), `${label}.constantByteLength`, constantBindingCount),
		textureSlot: requireVectorCount(decodeBoundedU8Vector(requireObjectKey(object, 'textureSlot', label, `${label}.textureSlot`), `${label}.textureSlot`, VDP_RPU_TEXTURE_BINDING_CAPACITY), `${label}.textureSlot`, textureBindingCount),
		textureSurfaceDescAddr: requireVectorCount(decodeBoundedU32Vector(requireObjectKey(object, 'textureSurfaceDescAddr', label, `${label}.textureSurfaceDescAddr`), `${label}.textureSurfaceDescAddr`, VDP_RPU_TEXTURE_BINDING_CAPACITY), `${label}.textureSurfaceDescAddr`, textureBindingCount),
	};
}

function encodeVdpRpuFrameState(state: VdpRpuFrameSaveState): VdpRpuFrameSaveState {
	return {
		commands: encodeVdpRpuCommandBufferState(state.commands),
	};
}

function decodeVdpRpuFrameState(value: unknown, label: string): VdpRpuFrameSaveState {
	const object = requireObject(value, label);
	return {
		commands: decodeVdpRpuCommandBufferState(requireObjectKey(object, 'commands', label, `${label}.commands`), `${label}.commands`),
	};
}

function encodeVdpRpuState(state: VdpRpuSaveState): VdpRpuSaveState {
	return {
		buildState: state.buildState,
		vdpVram: state.vdpVram,
	};
}

function decodeVdpRpuState(value: unknown, label: string): VdpRpuSaveState {
	const object = requireObject(value, label);
	return {
		buildState: requireBoundedU32(requireObjectKey(object, 'buildState', label, `${label}.buildState`), `${label}.buildState`, 0, 3) as VdpRpuSaveState['buildState'],
		vdpVram: decodeBoundedU8Vector(requireObjectKey(object, 'vdpVram', label, `${label}.vdpVram`), `${label}.vdpVram`, VRAM_STAGING_SIZE),
	};
}

function encodeBuildingFrameState(state: VdpBuildingFrameSaveState): VdpBuildingFrameSaveState {
	return {
		state: state.state,
		rpu: encodeVdpRpuFrameState(state.rpu),
		cost: state.cost,
	};
}

function decodeBuildingFrameState(value: unknown, label: string): VdpBuildingFrameSaveState {
	const object = requireObject(value, label);
	return {
		state: requireBoundedU32(requireObjectKey(object, 'state', label, `${label}.state`), `${label}.state`, VDP_DEX_FRAME_IDLE, VDP_DEX_FRAME_STREAM_OPEN) as typeof VDP_DEX_FRAME_IDLE | typeof VDP_DEX_FRAME_DIRECT_OPEN | typeof VDP_DEX_FRAME_STREAM_OPEN,
		rpu: decodeVdpRpuFrameState(requireObjectKey(object, 'rpu', label, `${label}.rpu`), `${label}.rpu`),
		cost: requireI32(requireObjectKey(object, 'cost', label, `${label}.cost`), `${label}.cost`),
	};
}

function encodeSubmittedFrameState(state: VdpSubmittedFrameSaveState): VdpSubmittedFrameSaveState {
	return {
		state: state.state,
		hasCommands: state.hasCommands,
		cost: state.cost,
		workRemaining: state.workRemaining,
		ditherType: state.ditherType,
		frameBufferWidth: state.frameBufferWidth,
		frameBufferHeight: state.frameBufferHeight,
		xf: state.xf,
		lightRegisterWords: state.lightRegisterWords,
		morphWeightWords: state.morphWeightWords,
		jointMatrixWords: state.jointMatrixWords,
		rpu: encodeVdpRpuFrameState(state.rpu),
	};
}

function decodeSubmittedFrameState(value: unknown, label: string): VdpSubmittedFrameSaveState {
	const object = requireObject(value, label);
	return {
		state: requireBoundedU32(requireObjectKey(object, 'state', label, `${label}.state`), `${label}.state`, VDP_SUBMITTED_FRAME_EMPTY, VDP_SUBMITTED_FRAME_READY) as typeof VDP_SUBMITTED_FRAME_EMPTY | typeof VDP_SUBMITTED_FRAME_QUEUED | typeof VDP_SUBMITTED_FRAME_EXECUTING | typeof VDP_SUBMITTED_FRAME_READY,
		hasCommands: requireBooleanValue(requireObjectKey(object, 'hasCommands', label, `${label}.hasCommands`), `${label}.hasCommands`),
		cost: requireI32(requireObjectKey(object, 'cost', label, `${label}.cost`), `${label}.cost`),
		workRemaining: requireI32(requireObjectKey(object, 'workRemaining', label, `${label}.workRemaining`), `${label}.workRemaining`),
		ditherType: requireI32(requireObjectKey(object, 'ditherType', label, `${label}.ditherType`), `${label}.ditherType`),
		frameBufferWidth: requireBoundedU32(requireObjectKey(object, 'frameBufferWidth', label, `${label}.frameBufferWidth`), `${label}.frameBufferWidth`, 0, 0xffffffff),
		frameBufferHeight: requireBoundedU32(requireObjectKey(object, 'frameBufferHeight', label, `${label}.frameBufferHeight`), `${label}.frameBufferHeight`, 0, 0xffffffff),
		xf: decodeVdpXfState(requireObjectKey(object, 'xf', label, `${label}.xf`), `${label}.xf`),
		lightRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'lightRegisterWords', label, `${label}.lightRegisterWords`), `${label}.lightRegisterWords`, VDP_LPU_REGISTER_WORDS),
		morphWeightWords: decodeU32FixedArray(requireObjectKey(object, 'morphWeightWords', label, `${label}.morphWeightWords`), `${label}.morphWeightWords`, VDP_MFU_WEIGHT_COUNT),
		jointMatrixWords: decodeU32FixedArray(requireObjectKey(object, 'jointMatrixWords', label, `${label}.jointMatrixWords`), `${label}.jointMatrixWords`, VDP_JTU_REGISTER_WORDS),
		rpu: decodeVdpRpuFrameState(requireObjectKey(object, 'rpu', label, `${label}.rpu`), `${label}.rpu`),
	};
}

function encodeVdpStreamIngressState(state: VdpStreamIngressState): VdpStreamIngressState {
	return {
		dmaSubmitActive: state.dmaSubmitActive,
		fifoWordScratch: state.fifoWordScratch,
		fifoWordByteCount: state.fifoWordByteCount,
		fifoStreamWords: state.fifoStreamWords,
		fifoStreamWordCount: state.fifoStreamWordCount,
	};
}

function decodeVdpStreamIngressState(value: unknown, label: string): VdpStreamIngressState {
	const object = requireObject(value, label);
	const fifoStreamWords = decodeVector(
		requireObjectKey(object, 'fifoStreamWords', label, `${label}.fifoStreamWords`),
		`${label}.fifoStreamWords`,
		(entry) => requireBoundedU32(entry, `${label}.fifoStreamWords[]`, 0, 0xffffffff),
	);
	const fifoStreamWordCount = requireBoundedU32(requireObjectKey(object, 'fifoStreamWordCount', label, `${label}.fifoStreamWordCount`), `${label}.fifoStreamWordCount`, 0, 0xffffffff);
	if (fifoStreamWords.length !== fifoStreamWordCount || fifoStreamWordCount > VDP_STREAM_CAPACITY_WORDS) {
		throw new Error('machine.vdp.streamIngress state is inconsistent.');
	}
	return {
		dmaSubmitActive: requireBooleanValue(requireObjectKey(object, 'dmaSubmitActive', label, `${label}.dmaSubmitActive`), `${label}.dmaSubmitActive`),
		fifoWordScratch: decodeU8FixedArray(requireObjectKey(object, 'fifoWordScratch', label, `${label}.fifoWordScratch`), `${label}.fifoWordScratch`, 4),
		fifoWordByteCount: requireBoundedU32(requireObjectKey(object, 'fifoWordByteCount', label, `${label}.fifoWordByteCount`), `${label}.fifoWordByteCount`, 0, 3),
		fifoStreamWords,
		fifoStreamWordCount,
	};
}

function encodeVdpReadbackState(state: VdpReadbackState): VdpReadbackState {
	return {
		readBudgetBytes: state.readBudgetBytes,
		readOverflow: state.readOverflow,
	};
}

function decodeVdpReadbackState(value: unknown, label: string): VdpReadbackState {
	const object = requireObject(value, label);
	return {
		readBudgetBytes: requireBoundedU32(requireObjectKey(object, 'readBudgetBytes', label, `${label}.readBudgetBytes`), `${label}.readBudgetBytes`, 0, 0xffffffff),
		readOverflow: requireBooleanValue(requireObjectKey(object, 'readOverflow', label, `${label}.readOverflow`), `${label}.readOverflow`),
	};
}

function encodeVdpState(state: VdpState): VdpState {
	return {
		xf: encodeVdpXfState(state.xf),
		vdpRegisterWords: state.vdpRegisterWords,
		buildFrame: encodeBuildingFrameState(state.buildFrame),
		activeFrame: encodeSubmittedFrameState(state.activeFrame),
		pendingFrame: encodeSubmittedFrameState(state.pendingFrame),
		rpu: encodeVdpRpuState(state.rpu),
		workCarry: state.workCarry,
		availableWorkUnits: state.availableWorkUnits,
		streamIngress: encodeVdpStreamIngressState(state.streamIngress),
		readback: encodeVdpReadbackState(state.readback),
		lightRegisterWords: state.lightRegisterWords,
		morphWeightWords: state.morphWeightWords,
		jointMatrixWords: state.jointMatrixWords,
		ditherType: state.ditherType,
		vdpFaultCode: state.vdpFaultCode,
		vdpFaultDetail: state.vdpFaultDetail,
	};
}

function decodeVdpState(value: unknown, label: string): VdpState {
	const object = requireObject(value, label);
	return {
		xf: decodeVdpXfState(requireObjectKey(object, 'xf', label, 'machine.vdp.xf'), 'machine.vdp.xf'),
		vdpRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'vdpRegisterWords', label, 'machine.vdp.vdpRegisterWords'), 'machine.vdp.vdpRegisterWords', VDP_REGISTER_COUNT),
		buildFrame: decodeBuildingFrameState(requireObjectKey(object, 'buildFrame', label, 'machine.vdp.buildFrame'), 'machine.vdp.buildFrame'),
		activeFrame: decodeSubmittedFrameState(requireObjectKey(object, 'activeFrame', label, 'machine.vdp.activeFrame'), 'machine.vdp.activeFrame'),
		pendingFrame: decodeSubmittedFrameState(requireObjectKey(object, 'pendingFrame', label, 'machine.vdp.pendingFrame'), 'machine.vdp.pendingFrame'),
		rpu: decodeVdpRpuState(requireObjectKey(object, 'rpu', label, 'machine.vdp.rpu'), 'machine.vdp.rpu'),
		workCarry: requireI64(requireObjectKey(object, 'workCarry', label, 'machine.vdp.workCarry'), 'machine.vdp.workCarry'),
		availableWorkUnits: requireI32(requireObjectKey(object, 'availableWorkUnits', label, 'machine.vdp.availableWorkUnits'), 'machine.vdp.availableWorkUnits'),
		streamIngress: decodeVdpStreamIngressState(requireObjectKey(object, 'streamIngress', label, 'machine.vdp.streamIngress'), 'machine.vdp.streamIngress'),
		readback: decodeVdpReadbackState(requireObjectKey(object, 'readback', label, 'machine.vdp.readback'), 'machine.vdp.readback'),
		lightRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'lightRegisterWords', label, 'machine.vdp.lightRegisterWords'), 'machine.vdp.lightRegisterWords', VDP_LPU_REGISTER_WORDS),
		morphWeightWords: decodeU32FixedArray(requireObjectKey(object, 'morphWeightWords', label, 'machine.vdp.morphWeightWords'), 'machine.vdp.morphWeightWords', VDP_MFU_WEIGHT_COUNT),
		jointMatrixWords: decodeU32FixedArray(requireObjectKey(object, 'jointMatrixWords', label, 'machine.vdp.jointMatrixWords'), 'machine.vdp.jointMatrixWords', VDP_JTU_REGISTER_WORDS),
		ditherType: requireI32(requireObjectKey(object, 'ditherType', label, 'machine.vdp.ditherType'), 'machine.vdp.ditherType'),
		vdpFaultCode: requireBoundedU32(requireObjectKey(object, 'vdpFaultCode', label, 'machine.vdp.vdpFaultCode'), 'machine.vdp.vdpFaultCode', 0, 0xffffffff),
		vdpFaultDetail: requireBoundedU32(requireObjectKey(object, 'vdpFaultDetail', label, 'machine.vdp.vdpFaultDetail'), 'machine.vdp.vdpFaultDetail', 0, 0xffffffff),
	};
}

function encodeVdpSurfacePixelsState(state: VdpSurfacePixelsState): VdpSurfacePixelsState {
	return {
		surfaceId: state.surfaceId,
		surfaceWidth: state.surfaceWidth,
		surfaceHeight: state.surfaceHeight,
		pixels: state.pixels,
	};
}

function decodeVdpSurfacePixelsState(value: unknown, label: string): VdpSurfacePixelsState {
	const object = requireObject(value, label);
	return {
		surfaceId: requireObjectKey(object, 'surfaceId', label, 'machine.vdp.vram.surfacePixels.surfaceId') as number,
		surfaceWidth: requireObjectKey(object, 'surfaceWidth', label, 'machine.vdp.vram.surfacePixels.surfaceWidth') as number,
		surfaceHeight: requireObjectKey(object, 'surfaceHeight', label, 'machine.vdp.vram.surfacePixels.surfaceHeight') as number,
		pixels: requireBinaryValue(requireObjectKey(object, 'pixels', label, 'machine.vdp.vram.surfacePixels.pixels'), 'machine.vdp.vram.surfacePixels.pixels'),
	};
}

function encodeVdpVramState(state: VdpVramState): VdpVramState {
	return {
		staging: state.staging,
		surfacePixels: encodeVector(state.surfacePixels, encodeVdpSurfacePixelsState),
	};
}

function decodeVdpVramState(value: unknown, label: string): VdpVramState {
	const object = requireObject(value, label);
	return {
		staging: requireBinaryValue(requireObjectKey(object, 'staging', label, 'machine.vdp.vram.staging'), 'machine.vdp.vram.staging'),
		surfacePixels: decodeVector(
			requireObjectKey(object, 'surfacePixels', label, 'machine.vdp.vram.surfacePixels'),
			'machine.vdp.vram.surfacePixels',
			(entry) => decodeVdpSurfacePixelsState(entry, 'machine.vdp.vram.surfacePixels[]'),
		),
	};
}

function encodeVdpSaveState(state: VdpSaveState): VdpSaveState {
	return {
		...encodeVdpState(state),
		vram: encodeVdpVramState(state.vram),
		displayFrameBufferPixels: state.displayFrameBufferPixels,
	};
}

function decodeVdpSaveState(value: unknown, label: string): VdpSaveState {
	const object = requireObject(value, label);
	return {
		...decodeVdpState(value, label),
		vram: decodeVdpVramState(requireObjectKey(object, 'vram', label, 'machine.vdp.vram'), 'machine.vdp.vram'),
		displayFrameBufferPixels: requireBinaryValue(requireObjectKey(object, 'displayFrameBufferPixels', label, 'machine.vdp.displayFrameBufferPixels'), 'machine.vdp.displayFrameBufferPixels'),
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

function encodeMachineSaveState(state: MachineSaveState): MachineSaveState {
	return {
		memory: encodeMemorySaveState(state.memory),
		geometry: encodeGeometryControllerState(state.geometry),
		irq: encodeIrqControllerState(state.irq),
		audio: encodeAudioControllerState(state.audio),
		stringPool: encodeStringPoolState(state.stringPool),
		input: encodeInputControllerState(state.input),
		vdp: encodeVdpSaveState(state.vdp),
	};
}

function decodeMachineSaveState(value: unknown, label: string): MachineSaveState {
	const object = requireObject(value, label);
	return {
		memory: decodeMemorySaveState(requireObjectKey(object, 'memory', label, 'machineState.machine.memory'), 'machineState.machine.memory'),
		geometry: decodeGeometryControllerState(requireObjectKey(object, 'geometry', label, 'machineState.machine.geometry'), 'machineState.machine.geometry'),
		irq: decodeIrqControllerState(requireObjectKey(object, 'irq', label, 'machineState.machine.irq'), 'machineState.machine.irq'),
		audio: decodeAudioControllerState(requireObjectKey(object, 'audio', label, 'machineState.machine.audio'), 'machineState.machine.audio'),
		stringPool: decodeStringPoolState(requireObjectKey(object, 'stringPool', label, 'machineState.machine.stringPool'), 'machineState.machine.stringPool'),
		input: decodeInputControllerState(requireObjectKey(object, 'input', label, 'machineState.machine.input'), 'machineState.machine.input'),
		vdp: decodeVdpSaveState(requireObjectKey(object, 'vdp', label, 'machineState.machine.vdp'), 'machineState.machine.vdp'),
	};
}

function encodeRuntimeSaveMachineState(state: RuntimeSaveMachineState): RuntimeSaveMachineState {
	return {
		machineRegionWord: state.machineRegionWord,
		machine: encodeMachineSaveState(state.machine),
		frameScheduler: encodeFrameSchedulerState(state.frameScheduler),
		vblank: encodeRuntimeVblankState(state.vblank),
	};
}

function decodeRuntimeSaveMachineState(value: unknown, label: string): RuntimeSaveMachineState {
	const object = requireObject(value, label);
	return {
		machineRegionWord: requireObjectKey(object, 'machineRegionWord', label, 'machineState.machineRegionWord') as number,
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
		case 'ref':
			return { tag: 'ref', id: state.id };
		case 'stable_ref':
			return { tag: 'stable_ref', path: encodeVector(state.path, (segment) => segment) };
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
		case 'ref':
			return { tag: 'ref', id: requireObjectKey(object, 'id', label, 'cpuValueState.id') as number };
		case 'stable_ref':
			return {
				tag: 'stable_ref',
				path: decodeVector<CpuRuntimeRefSegment>(
					requireObjectKey(object, 'path', label, 'cpuValueState.path'),
					'cpuValueState.path',
					(segment) => segment as CpuRuntimeRefSegment,
				),
			};
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
				array: encodeVector(state.array, encodeCpuValueState),
				arrayLength: state.arrayLength,
				hash: encodeVector(state.hash, encodeCpuTableHashNodeState),
				hashFree: state.hashFree,
				metatable: encodeCpuValueState(state.metatable),
			};
		case 'closure':
			return {
				kind: 'closure',
				protoIndex: state.protoIndex,
				upvalues: encodeVector(state.upvalues, (index) => index),
			};
		case 'upvalue':
			return {
				kind: 'upvalue',
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
