import { decodeBinaryWithPropTable, encodeBinaryWithPropTable, requireObject, requireObjectKey } from '../../../common/serializer/binencoder';
import { IO_DMA_CHANNEL_COUNT, SYS_PRINT_BUFFER_BYTES } from '../../bus/io';
import type { MachineSaveState } from '../../save_state';
import type { CpuFrameState, CpuObjectState, CpuProtectedCallState, CpuRootValueState, CpuRuntimeState, CpuValueState } from '../../cpu/cpu';
import type { ExecutionDomainId } from '../../execution_address_space';
import type { BuiltinFunctionId } from '../../cpu/value';
import type { IrqControllerState } from '../../devices/irq/save_state';
import type { AudioControllerState } from '../../devices/audio/save_state';
import type {
	CartridgeControllerState,
	CartridgeSlotState,
} from '../../devices/cartridge/contracts';
import { CARTRIDGE_SLOT_COUNT } from '../../devices/cartridge/contracts';
import type { DmaChannelState, DmaControllerState } from '../../devices/dma/controller';
import type {
	ApuBadpDecoderSaveState,
	ApuBiquadFilterState,
	ApuOutputState,
	ApuOutputVoiceState,
} from '../../devices/audio/save_state';
import type { ApuCommandFifoState } from '../../devices/audio/command_fifo';
import type { ApuSampleTransferState } from '../../devices/audio/save_state';
import { APU_COMMAND_FIFO_CAPACITY, APU_COMMAND_FIFO_REGISTER_WORD_COUNT, APU_PARAMETER_REGISTER_COUNT, APU_SAMPLE_RAM_ADDRESS_MASK, APU_SAMPLE_RAM_BYTES, APU_SLOT_COUNT, APU_SLOT_REGISTER_WORD_COUNT, APU_TRANSFER_FIFO_WORD_CAPACITY } from '../../devices/audio/contracts';
import type { StringPoolState, StringPoolStateEntry } from '../../cpu/string_pool';
import type { InputControllerState } from '../../devices/input/save_state';
import type { ImgDecControllerState } from '../../devices/imgdec/controller';
import {
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_INPUT_FIFO_WORD_CAPACITY,
	IMGDEC_OUTPUT_FIFO_WORD_CAPACITY,
	IMGDEC_DECODE_BATCH_WORDS,
} from '../../devices/imgdec/contracts';
import { INPUT_CONTROLLER_KEY_WORD_COUNT, INPUT_CONTROLLER_PAD_AXIS_COUNT, INPUT_CONTROLLER_PAD_COUNT } from '../../devices/input/contracts';
import {
	SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE,
	SYSTEM_SUPERVISOR_TARGET_SUPERVISOR,
	type SystemControllerState,
} from '../../devices/system/controller';
import {
	GEOMETRY_CONTROLLER_PHASE_REJECTED,
	GEOMETRY_CONTROLLER_REGISTER_COUNT,
	type GeometryControllerPhase,
} from '../../devices/geometry/contracts';
import {
	type GxGpuIngressContextState,
	type GxGpuRegisterContextState,
	type GxGpuSaveState,
	type GxGpuState,
} from '../../devices/gx/gpu';
import {
	GX_GPU_COMMAND_FIFO_WORD_CAPACITY,
	GX_GPU_DMA_INGRESS_WORD_CAPACITY,
	GX_GPU_GP0_COMMAND_BUFFER_WORDS,
	GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD,
} from '../../devices/gx/gp0';
import { GX_GPU_COMMAND_CAPACITY, GX_GPU_COMMAND_WORD_CAPACITY, GX_GPU_READBACK_READY, GX_GPU_READBACK_SUBMITTED, GX_GPU_TRANSFER_MAX_HEIGHT, type GxGpuCommandBufferState } from '../../devices/gx/gpu_command_buffer';
import {
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_VRAM_WIDTH,
	GX_GPU_VRAM_Y_ADDRESS_PERIOD,
} from '../../devices/gx/vram_address';
import { GX_GPU_PCRTC_COMPOSITION_WORD_COUNT, GX_GPU_PCRTC_CONFIG_WORD_COUNT, type GxGpuPcrtcState } from '../../devices/gx/gpu_pcrtc';
import type { GxGteState } from '../../devices/gx/gte';
import { GX_GTE_CONTROL_REGISTER_COUNT, GX_GTE_DATA_REGISTER_COUNT, GX_GTE_PLUS_REGISTER_COUNT } from '../../devices/gx/gte';
import type { GeometryJobState } from '../../devices/geometry/job';
import type { GeometryControllerState } from '../../devices/geometry/save_state';
import type { MemorySaveState } from '../../memory/memory';
import { RAM_BASE } from '../../../spec/bmsx/memory_map';
import { RAM_END } from '../../memory/map';
import type { FrameSchedulerStateSnapshot } from '../../scheduler/frame';
import type { FrameLoopStateSnapshot } from '../frame/loop';
import type { RuntimeSaveMachineState } from '../save_machine_state';
import type { RuntimeSaveState } from '../save_state';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../save_state';
import { RUNTIME_SAVE_STATE_PROP_NAMES } from './schema';
import type { Runtime } from '../runtime';

export const RUNTIME_SAVE_STATE_BASE_WIRE_CAPACITY = 0x01000000;

export function runtimeSaveStateWireCapacity(cartridgeRamByteCount: number): number {
	return RUNTIME_SAVE_STATE_BASE_WIRE_CAPACITY + cartridgeRamByteCount;
}

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

function decodeU32VectorWithMaxLength(value: unknown, label: string, maxLength: number): number[] {
	const entries = requireArray(value, label);
	if (entries.length > maxLength) {
		throw new Error(`${label} must contain at most ${maxLength} u32 values.`);
	}
	return decodeVector(entries, label, (word, index) => requireBoundedU32(word, `${label}[${index}]`, 0, 0xffffffff));
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

function requireI16(value: unknown, label: string): number {
	const word = requireI32(value, label);
	if (word < -0x8000 || word > 0x7fff) {
		throw new Error(`${label} must be an i16 value.`);
	}
	return word;
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
	if (!Object.is(number, +number)) {
		throw new Error(`${label} must be a numeric value.`);
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

function encodeFrameSchedulerState(state: FrameSchedulerStateSnapshot): FrameSchedulerStateSnapshot {
	return {
		accumulatedHostTimeMs: state.accumulatedHostTimeMs,
		cycleGrantRemainder: state.cycleGrantRemainder,
		carriedCycleBudget: state.carriedCycleBudget,
		tickCompletionPending: state.tickCompletionPending,
		tickCompletionVisualCommitted: state.tickCompletionVisualCommitted,
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
		accumulatedHostTimeMs: requireNumberValue(requireObjectKey(object, 'accumulatedHostTimeMs', label, 'frameScheduler.accumulatedHostTimeMs'), 'frameScheduler.accumulatedHostTimeMs'),
		cycleGrantRemainder: requireNumberValue(requireObjectKey(object, 'cycleGrantRemainder', label, 'frameScheduler.cycleGrantRemainder'), 'frameScheduler.cycleGrantRemainder'),
		carriedCycleBudget: requireI64(requireObjectKey(object, 'carriedCycleBudget', label, 'frameScheduler.carriedCycleBudget'), 'frameScheduler.carriedCycleBudget'),
		tickCompletionPending: requireBooleanValue(requireObjectKey(object, 'tickCompletionPending', label, 'frameScheduler.tickCompletionPending'), 'frameScheduler.tickCompletionPending'),
		tickCompletionVisualCommitted: requireBooleanValue(requireObjectKey(object, 'tickCompletionVisualCommitted', label, 'frameScheduler.tickCompletionVisualCommitted'), 'frameScheduler.tickCompletionVisualCommitted'),
		lastTickSequence: requireI64(requireObjectKey(object, 'lastTickSequence', label, 'frameScheduler.lastTickSequence'), 'frameScheduler.lastTickSequence'),
		lastTickBudgetGranted: requireI64(requireObjectKey(object, 'lastTickBudgetGranted', label, 'frameScheduler.lastTickBudgetGranted'), 'frameScheduler.lastTickBudgetGranted'),
		lastTickCpuBudgetGranted: requireI64(requireObjectKey(object, 'lastTickCpuBudgetGranted', label, 'frameScheduler.lastTickCpuBudgetGranted'), 'frameScheduler.lastTickCpuBudgetGranted'),
		lastTickCpuUsedCycles: requireI64(requireObjectKey(object, 'lastTickCpuUsedCycles', label, 'frameScheduler.lastTickCpuUsedCycles'), 'frameScheduler.lastTickCpuUsedCycles'),
		lastTickBudgetRemaining: requireI64(requireObjectKey(object, 'lastTickBudgetRemaining', label, 'frameScheduler.lastTickBudgetRemaining'), 'frameScheduler.lastTickBudgetRemaining'),
		lastTickVisualFrameCommitted: requireObjectKey(object, 'lastTickVisualFrameCommitted', label, 'frameScheduler.lastTickVisualFrameCommitted') as boolean,
		lastTickCompleted: requireObjectKey(object, 'lastTickCompleted', label, 'frameScheduler.lastTickCompleted') as boolean,
		lastTickConsumedSequence: requireI64(requireObjectKey(object, 'lastTickConsumedSequence', label, 'frameScheduler.lastTickConsumedSequence'), 'frameScheduler.lastTickConsumedSequence'),
	};
}

function encodeFrameLoopState(state: FrameLoopStateSnapshot): FrameLoopStateSnapshot {
	return {
		frameState: {
			updateExecuted: state.frameState.updateExecuted,
			luaFaulted: state.frameState.luaFaulted,
			cycleBudgetRemaining: state.frameState.cycleBudgetRemaining,
			cycleBudgetGranted: state.frameState.cycleBudgetGranted,
			cycleCarryGranted: state.frameState.cycleCarryGranted,
			activeCpuUsedCycles: state.frameState.activeCpuUsedCycles,
		},
		frameActive: state.frameActive,
		frameDeltaMs: state.frameDeltaMs,
	};
}

function decodeFrameLoopState(value: unknown, label: string): FrameLoopStateSnapshot {
	const object = requireObject(value, label);
	const frameState = requireObject(requireObjectKey(object, 'frameState', label, `${label}.frameState`), `${label}.frameState`);
	return {
		frameState: {
			updateExecuted: requireBooleanValue(requireObjectKey(frameState, 'updateExecuted', label, `${label}.frameState.updateExecuted`), `${label}.frameState.updateExecuted`),
			luaFaulted: requireBooleanValue(requireObjectKey(frameState, 'luaFaulted', label, `${label}.frameState.luaFaulted`), `${label}.frameState.luaFaulted`),
			cycleBudgetRemaining: requireI64(requireObjectKey(frameState, 'cycleBudgetRemaining', label, `${label}.frameState.cycleBudgetRemaining`), `${label}.frameState.cycleBudgetRemaining`),
			cycleBudgetGranted: requireI64(requireObjectKey(frameState, 'cycleBudgetGranted', label, `${label}.frameState.cycleBudgetGranted`), `${label}.frameState.cycleBudgetGranted`),
			cycleCarryGranted: requireI64(requireObjectKey(frameState, 'cycleCarryGranted', label, `${label}.frameState.cycleCarryGranted`), `${label}.frameState.cycleCarryGranted`),
			activeCpuUsedCycles: requireI64(requireObjectKey(frameState, 'activeCpuUsedCycles', label, `${label}.frameState.activeCpuUsedCycles`), `${label}.frameState.activeCpuUsedCycles`),
		},
		frameActive: requireBooleanValue(requireObjectKey(object, 'frameActive', label, `${label}.frameActive`), `${label}.frameActive`),
		frameDeltaMs: requireObjectKey(object, 'frameDeltaMs', label, `${label}.frameDeltaMs`) as number,
	};
}

function encodeCartridgeSlotState(state: CartridgeSlotState): CartridgeSlotState {
	return {
		ram: state.ram,
		mailboxDataWord: state.mailboxDataWord >>> 0,
		mailboxControlWord: state.mailboxControlWord >>> 0,
		mailboxIrqPending: state.mailboxIrqPending,
	};
}

function decodeCartridgeSlotState(value: unknown, label: string): CartridgeSlotState {
	const object = requireObject(value, label);
	return {
		ram: requireBinaryValue(requireObjectKey(object, 'ram', label, `${label}.ram`), `${label}.ram`),
		mailboxDataWord: requireBoundedU32(requireObjectKey(object, 'mailboxDataWord', label, `${label}.mailboxDataWord`), `${label}.mailboxDataWord`, 0, 0xffffffff),
		mailboxControlWord: requireBoundedU32(requireObjectKey(object, 'mailboxControlWord', label, `${label}.mailboxControlWord`), `${label}.mailboxControlWord`, 0, 0xffffffff),
		mailboxIrqPending: requireBooleanValue(requireObjectKey(object, 'mailboxIrqPending', label, `${label}.mailboxIrqPending`), `${label}.mailboxIrqPending`),
	};
}

function encodeCartridgeControllerState(state: CartridgeControllerState): CartridgeControllerState {
	return {
		selectionWord: state.selectionWord >>> 0,
		slots: [
			encodeCartridgeSlotState(state.slots[0]),
			encodeCartridgeSlotState(state.slots[1]),
		],
	};
}

function decodeCartridgeControllerState(value: unknown, label: string): CartridgeControllerState {
	const object = requireObject(value, label);
	const slots = requireArray(requireObjectKey(object, 'slots', label, `${label}.slots`), `${label}.slots`);
	if (slots.length !== CARTRIDGE_SLOT_COUNT) {
		throw new Error(`${label}.slots must contain ${CARTRIDGE_SLOT_COUNT} cartridge slot states.`);
	}
	return {
		selectionWord: requireBoundedU32(requireObjectKey(object, 'selectionWord', label, `${label}.selectionWord`), `${label}.selectionWord`, 0, 0xffffffff),
		slots: [
			decodeCartridgeSlotState(slots[0], `${label}.slots[0]`),
			decodeCartridgeSlotState(slots[1], `${label}.slots[1]`),
		],
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
		userMask: state.userMask >>> 0,
		userPendingFlags: state.userPendingFlags >>> 0,
		supervisorContextActive: state.supervisorContextActive,
	};
}

function decodeIrqControllerState(value: unknown, label: string): IrqControllerState {
	const object = requireObject(value, label);
	return {
		mask: requireBoundedU32(requireObjectKey(object, 'mask', label, 'machine.irq.mask'), 'machine.irq.mask', 0, 0xffffffff),
		pendingFlags: requireBoundedU32(requireObjectKey(object, 'pendingFlags', label, 'machine.irq.pendingFlags'), 'machine.irq.pendingFlags', 0, 0xffffffff),
		userMask: requireBoundedU32(requireObjectKey(object, 'userMask', label, 'machine.irq.userMask'), 'machine.irq.userMask', 0, 0xffffffff),
		userPendingFlags: requireBoundedU32(requireObjectKey(object, 'userPendingFlags', label, 'machine.irq.userPendingFlags'), 'machine.irq.userPendingFlags', 0, 0xffffffff),
		supervisorContextActive: requireBooleanValue(requireObjectKey(object, 'supervisorContextActive', label, 'machine.irq.supervisorContextActive'), 'machine.irq.supervisorContextActive'),
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
		supervisorRequestLineHigh: state.supervisorRequestLineHigh,
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
		supervisorRequestLineHigh: requireBooleanValue(requireObjectKey(object, 'supervisorRequestLineHigh', label, 'machine.input.supervisorRequestLineHigh'), 'machine.input.supervisorRequestLineHigh'),
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
		supervisorQuiesceRequested: state.supervisorQuiesceRequested,
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
		supervisorQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorQuiesceRequested', label, 'machine.geometry.supervisorQuiesceRequested'), 'machine.geometry.supervisorQuiesceRequested'),
	};
}

function encodeGxGpuCommandBufferState(state: GxGpuCommandBufferState): GxGpuCommandBufferState {
	return {
		commandCount: state.commandCount >>> 0,
		executedCommandCount: state.executedCommandCount >>> 0,
		presentCommandCount: state.presentCommandCount >>> 0,
		wordCount: state.wordCount >>> 0,
		commandKind: encodeVector(state.commandKind, (word) => word >>> 0),
		commandOpcode: encodeVector(state.commandOpcode, (word) => word >>> 0),
		commandWordStart: encodeVector(state.commandWordStart, (word) => word >>> 0),
		commandWordCount: encodeVector(state.commandWordCount, (word) => word >>> 0),
		commandDrawModeWord: encodeVector(state.commandDrawModeWord, (word) => word >>> 0),
		commandVramYAddressExtensionWord: encodeVector(state.commandVramYAddressExtensionWord, (word) => word >>> 0),
		commandTextureWindowWord: encodeVector(state.commandTextureWindowWord, (word) => word >>> 0),
		commandDrawingAreaTopLeftWord: encodeVector(state.commandDrawingAreaTopLeftWord, (word) => word >>> 0),
		commandDrawingAreaBottomRightWord: encodeVector(state.commandDrawingAreaBottomRightWord, (word) => word >>> 0),
		commandDrawingOffsetWord: encodeVector(state.commandDrawingOffsetWord, (word) => word >>> 0),
		commandMaskBitModeWord: encodeVector(state.commandMaskBitModeWord, (word) => word >>> 0),
		commandSkippedLineParity: encodeVector(state.commandSkippedLineParity, (word) => word >>> 0),
		words: encodeVector(state.words, (word) => word >>> 0),
		readbackPhase: state.readbackPhase,
		readbackFenceCommandCount: state.readbackFenceCommandCount,
		readbackX: state.readbackX,
		readbackY: state.readbackY,
		readbackVramYAddressExtensionWord: state.readbackVramYAddressExtensionWord,
		readbackWidth: state.readbackWidth,
		readbackHeight: state.readbackHeight,
		readbackPixelCursor: state.readbackPixelCursor,
		readbackPixelBytes: state.readbackPixelBytes,
	};
}

function decodeGxGpuCommandBufferState(value: unknown, label: string): GxGpuCommandBufferState {
	const object = requireObject(value, label);
	const commandCount = requireBoundedU32(requireObjectKey(object, 'commandCount', label, `${label}.commandCount`), `${label}.commandCount`, 0, GX_GPU_COMMAND_CAPACITY);
	const executedCommandCount = requireBoundedU32(requireObjectKey(object, 'executedCommandCount', label, `${label}.executedCommandCount`), `${label}.executedCommandCount`, 0, commandCount);
	const presentCommandCount = requireBoundedU32(requireObjectKey(object, 'presentCommandCount', label, `${label}.presentCommandCount`), `${label}.presentCommandCount`, 0, executedCommandCount);
	const wordCount = requireBoundedU32(requireObjectKey(object, 'wordCount', label, `${label}.wordCount`), `${label}.wordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY);
	const readbackWidth = requireBoundedU32(requireObjectKey(object, 'readbackWidth', label, `${label}.readbackWidth`), `${label}.readbackWidth`, 0, GX_GPU_VRAM_WIDTH);
	const readbackHeight = requireBoundedU32(requireObjectKey(object, 'readbackHeight', label, `${label}.readbackHeight`), `${label}.readbackHeight`, 0, GX_GPU_TRANSFER_MAX_HEIGHT);
	const readbackPixelCount = readbackWidth * readbackHeight;
	const readbackPhase = requireBoundedU32(requireObjectKey(object, 'readbackPhase', label, `${label}.readbackPhase`), `${label}.readbackPhase`, 0, GX_GPU_READBACK_READY);
	if (readbackPhase === GX_GPU_READBACK_SUBMITTED) {
		throw new Error(`${label}.readbackPhase cannot contain the backend-submitted phase.`);
	}
	return {
		commandCount,
		executedCommandCount,
		presentCommandCount,
		wordCount,
		commandKind: decodeU8FixedArray(requireObjectKey(object, 'commandKind', label, `${label}.commandKind`), `${label}.commandKind`, commandCount),
		commandOpcode: decodeU8FixedArray(requireObjectKey(object, 'commandOpcode', label, `${label}.commandOpcode`), `${label}.commandOpcode`, commandCount),
		commandWordStart: decodeU32FixedArray(requireObjectKey(object, 'commandWordStart', label, `${label}.commandWordStart`), `${label}.commandWordStart`, commandCount),
		commandWordCount: decodeU32FixedArray(requireObjectKey(object, 'commandWordCount', label, `${label}.commandWordCount`), `${label}.commandWordCount`, commandCount),
		commandDrawModeWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawModeWord', label, `${label}.commandDrawModeWord`), `${label}.commandDrawModeWord`, commandCount),
		commandVramYAddressExtensionWord: decodeU8FixedArray(requireObjectKey(object, 'commandVramYAddressExtensionWord', label, `${label}.commandVramYAddressExtensionWord`), `${label}.commandVramYAddressExtensionWord`, commandCount),
		commandTextureWindowWord: decodeU32FixedArray(requireObjectKey(object, 'commandTextureWindowWord', label, `${label}.commandTextureWindowWord`), `${label}.commandTextureWindowWord`, commandCount),
		commandDrawingAreaTopLeftWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingAreaTopLeftWord', label, `${label}.commandDrawingAreaTopLeftWord`), `${label}.commandDrawingAreaTopLeftWord`, commandCount),
		commandDrawingAreaBottomRightWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingAreaBottomRightWord', label, `${label}.commandDrawingAreaBottomRightWord`), `${label}.commandDrawingAreaBottomRightWord`, commandCount),
		commandDrawingOffsetWord: decodeU32FixedArray(requireObjectKey(object, 'commandDrawingOffsetWord', label, `${label}.commandDrawingOffsetWord`), `${label}.commandDrawingOffsetWord`, commandCount),
		commandMaskBitModeWord: decodeU32FixedArray(requireObjectKey(object, 'commandMaskBitModeWord', label, `${label}.commandMaskBitModeWord`), `${label}.commandMaskBitModeWord`, commandCount),
		commandSkippedLineParity: decodeU8FixedArray(requireObjectKey(object, 'commandSkippedLineParity', label, `${label}.commandSkippedLineParity`), `${label}.commandSkippedLineParity`, commandCount),
		words: decodeU32FixedArray(requireObjectKey(object, 'words', label, `${label}.words`), `${label}.words`, wordCount),
		readbackPhase,
		readbackFenceCommandCount: requireBoundedU32(requireObjectKey(object, 'readbackFenceCommandCount', label, `${label}.readbackFenceCommandCount`), `${label}.readbackFenceCommandCount`, 0, commandCount),
		readbackX: requireBoundedU32(requireObjectKey(object, 'readbackX', label, `${label}.readbackX`), `${label}.readbackX`, 0, GX_GPU_VRAM_WIDTH - 1),
		readbackY: requireBoundedU32(requireObjectKey(object, 'readbackY', label, `${label}.readbackY`), `${label}.readbackY`, 0, GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1),
		readbackVramYAddressExtensionWord: requireBoundedU32(requireObjectKey(object, 'readbackVramYAddressExtensionWord', label, `${label}.readbackVramYAddressExtensionWord`), `${label}.readbackVramYAddressExtensionWord`, 0, 1),
		readbackWidth,
		readbackHeight,
		readbackPixelCursor: requireBoundedU32(requireObjectKey(object, 'readbackPixelCursor', label, `${label}.readbackPixelCursor`), `${label}.readbackPixelCursor`, 0, readbackPixelCount),
		readbackPixelBytes: requireBinaryFixedLength(requireObjectKey(object, 'readbackPixelBytes', label, `${label}.readbackPixelBytes`), `${label}.readbackPixelBytes`, readbackPhase === GX_GPU_READBACK_READY ? readbackPixelCount * 2 : 0),
	};
}

function encodeGxGpuRegisterContextState(state: GxGpuRegisterContextState): GxGpuRegisterContextState {
	return {
		gp0Word: state.gp0Word >>> 0,
		gp1Word: state.gp1Word >>> 0,
		displayModeWord: state.displayModeWord >>> 0,
		statusWord: state.statusWord >>> 0,
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
		vramYAddressExtensionWord: state.vramYAddressExtensionWord >>> 0,
		presentStatusWord: state.presentStatusWord >>> 0,
		presentDisplayModeWord: state.presentDisplayModeWord >>> 0,
		presentDisplayStartWord: state.presentDisplayStartWord >>> 0,
		presentVramYAddressExtensionWord: state.presentVramYAddressExtensionWord >>> 0,
		presentHorizontalDisplayRangeWord: state.presentHorizontalDisplayRangeWord >>> 0,
		presentVerticalDisplayRangeWord: state.presentVerticalDisplayRangeWord >>> 0,
		pcrtcRegisterWords: encodeVector(state.pcrtcRegisterWords, (word) => word >>> 0),
		pcrtcPresentWords: encodeVector(state.pcrtcPresentWords, (word) => word >>> 0),
		vramPresentationPending: state.vramPresentationPending,
	};
}

function decodeGxGpuRegisterContextState(value: unknown, label: string): GxGpuRegisterContextState {
	const object = requireObject(value, label);
	return {
		gp0Word: requireBoundedU32(requireObjectKey(object, 'gp0Word', label, `${label}.gp0Word`), `${label}.gp0Word`, 0, 0xffffffff),
		gp1Word: requireBoundedU32(requireObjectKey(object, 'gp1Word', label, `${label}.gp1Word`), `${label}.gp1Word`, 0, 0xffffffff),
		displayModeWord: requireBoundedU32(requireObjectKey(object, 'displayModeWord', label, `${label}.displayModeWord`), `${label}.displayModeWord`, 0, 0xffffffff),
		statusWord: requireBoundedU32(requireObjectKey(object, 'statusWord', label, `${label}.statusWord`), `${label}.statusWord`, 0, 0xffffffff),
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
		vramYAddressExtensionWord: requireBoundedU32(requireObjectKey(object, 'vramYAddressExtensionWord', label, `${label}.vramYAddressExtensionWord`), `${label}.vramYAddressExtensionWord`, 0, 1),
		presentStatusWord: requireBoundedU32(requireObjectKey(object, 'presentStatusWord', label, `${label}.presentStatusWord`), `${label}.presentStatusWord`, 0, 0xffffffff),
		presentDisplayModeWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayModeWord', label, `${label}.presentDisplayModeWord`), `${label}.presentDisplayModeWord`, 0, 0xffffffff),
		presentDisplayStartWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayStartWord', label, `${label}.presentDisplayStartWord`), `${label}.presentDisplayStartWord`, 0, 0xffffffff),
		presentVramYAddressExtensionWord: requireBoundedU32(requireObjectKey(object, 'presentVramYAddressExtensionWord', label, `${label}.presentVramYAddressExtensionWord`), `${label}.presentVramYAddressExtensionWord`, 0, 1),
		presentHorizontalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentHorizontalDisplayRangeWord', label, `${label}.presentHorizontalDisplayRangeWord`), `${label}.presentHorizontalDisplayRangeWord`, 0, 0xffffffff),
		presentVerticalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentVerticalDisplayRangeWord', label, `${label}.presentVerticalDisplayRangeWord`), `${label}.presentVerticalDisplayRangeWord`, 0, 0xffffffff),
		pcrtcRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'pcrtcRegisterWords', label, `${label}.pcrtcRegisterWords`), `${label}.pcrtcRegisterWords`, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT),
		pcrtcPresentWords: decodeU32FixedArray(requireObjectKey(object, 'pcrtcPresentWords', label, `${label}.pcrtcPresentWords`), `${label}.pcrtcPresentWords`, GX_GPU_PCRTC_COMPOSITION_WORD_COUNT),
		vramPresentationPending: requireBooleanValue(requireObjectKey(object, 'vramPresentationPending', label, `${label}.vramPresentationPending`), `${label}.vramPresentationPending`),
	};
}

function encodeGxGpuIngressContextState(state: GxGpuIngressContextState): GxGpuIngressContextState {
	return {
		gp0CommandTargetWordCount: state.gp0CommandTargetWordCount >>> 0,
		gp0CommandWords: encodeVector(state.gp0CommandWords, (word) => word >>> 0),
		gp0IngressPhase: state.gp0IngressPhase >>> 0,
		gp0IngressWordsRemaining: state.gp0IngressWordsRemaining >>> 0,
		gp0IngressPolylineWordsPerVertex: state.gp0IngressPolylineWordsPerVertex >>> 0,
		gp0IngressPolylinePayloadPhase: state.gp0IngressPolylinePayloadPhase >>> 0,
		gp0ImageLoadWordsRemaining: state.gp0ImageLoadWordsRemaining >>> 0,
		gp0ImageLoadCommandWordStart: state.gp0ImageLoadCommandWordStart >>> 0,
		gp0ImageLoadCommandWordCount: state.gp0ImageLoadCommandWordCount >>> 0,
		gp0ImageLoadCommandOpcode: state.gp0ImageLoadCommandOpcode >>> 0,
		gp0PolylineWordsPerVertex: state.gp0PolylineWordsPerVertex >>> 0,
		gp0PolylinePayloadPhase: state.gp0PolylinePayloadPhase >>> 0,
		gp0PolylineCommandWordStart: state.gp0PolylineCommandWordStart >>> 0,
		gp0PolylineCommandWordCount: state.gp0PolylineCommandWordCount >>> 0,
		gp0PolylineCommandOpcode: state.gp0PolylineCommandOpcode >>> 0,
		commandBufferWords: encodeVector(state.commandBufferWords, (word) => word >>> 0),
	};
}

function decodeGxGpuIngressContextState(value: unknown, label: string): GxGpuIngressContextState {
	const object = requireObject(value, label);
	return {
		gp0CommandTargetWordCount: requireBoundedU32(requireObjectKey(object, 'gp0CommandTargetWordCount', label, `${label}.gp0CommandTargetWordCount`), `${label}.gp0CommandTargetWordCount`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0CommandWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'gp0CommandWords', label, `${label}.gp0CommandWords`), `${label}.gp0CommandWords`, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0IngressPhase: requireBoundedU32(requireObjectKey(object, 'gp0IngressPhase', label, `${label}.gp0IngressPhase`), `${label}.gp0IngressPhase`, 0, GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD),
		gp0IngressWordsRemaining: requireBoundedU32(requireObjectKey(object, 'gp0IngressWordsRemaining', label, `${label}.gp0IngressWordsRemaining`), `${label}.gp0IngressWordsRemaining`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0IngressPolylineWordsPerVertex: requireBoundedU32(requireObjectKey(object, 'gp0IngressPolylineWordsPerVertex', label, `${label}.gp0IngressPolylineWordsPerVertex`), `${label}.gp0IngressPolylineWordsPerVertex`, 0, 2),
		gp0IngressPolylinePayloadPhase: requireBoundedU32(requireObjectKey(object, 'gp0IngressPolylinePayloadPhase', label, `${label}.gp0IngressPolylinePayloadPhase`), `${label}.gp0IngressPolylinePayloadPhase`, 0, 1),
		gp0ImageLoadWordsRemaining: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadWordsRemaining', label, `${label}.gp0ImageLoadWordsRemaining`), `${label}.gp0ImageLoadWordsRemaining`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandWordStart: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandWordStart', label, `${label}.gp0ImageLoadCommandWordStart`), `${label}.gp0ImageLoadCommandWordStart`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandWordCount: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandWordCount', label, `${label}.gp0ImageLoadCommandWordCount`), `${label}.gp0ImageLoadCommandWordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0ImageLoadCommandOpcode: requireBoundedU32(requireObjectKey(object, 'gp0ImageLoadCommandOpcode', label, `${label}.gp0ImageLoadCommandOpcode`), `${label}.gp0ImageLoadCommandOpcode`, 0, 0xff),
		gp0PolylineWordsPerVertex: requireBoundedU32(requireObjectKey(object, 'gp0PolylineWordsPerVertex', label, `${label}.gp0PolylineWordsPerVertex`), `${label}.gp0PolylineWordsPerVertex`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0PolylinePayloadPhase: requireBoundedU32(requireObjectKey(object, 'gp0PolylinePayloadPhase', label, `${label}.gp0PolylinePayloadPhase`), `${label}.gp0PolylinePayloadPhase`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0PolylineCommandWordStart: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandWordStart', label, `${label}.gp0PolylineCommandWordStart`), `${label}.gp0PolylineCommandWordStart`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0PolylineCommandWordCount: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandWordCount', label, `${label}.gp0PolylineCommandWordCount`), `${label}.gp0PolylineCommandWordCount`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0PolylineCommandOpcode: requireBoundedU32(requireObjectKey(object, 'gp0PolylineCommandOpcode', label, `${label}.gp0PolylineCommandOpcode`), `${label}.gp0PolylineCommandOpcode`, 0, 0xff),
		commandBufferWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'commandBufferWords', label, `${label}.commandBufferWords`), `${label}.commandBufferWords`, GX_GPU_COMMAND_WORD_CAPACITY),
	};
}

function encodeGxGpuPcrtcState(state: GxGpuPcrtcState): GxGpuPcrtcState {
	return {
		registerWords: encodeVector(state.registerWords, (word) => word >>> 0),
		presentWords: encodeVector(state.presentWords, (word) => word >>> 0),
		csrWord: state.csrWord >>> 0,
		imrWord: state.imrWord >>> 0,
		beamCycleOffset: state.beamCycleOffset,
		beamRemainder: state.beamRemainder,
		beamHalfLine: state.beamHalfLine,
		nextHsyncHalfLine: state.nextHsyncHalfLine,
		verticalStage: state.verticalStage,
		vblankActive: state.vblankActive,
	};
}

function decodeGxGpuPcrtcState(value: unknown, label: string): GxGpuPcrtcState {
	const object = requireObject(value, label);
	return {
		registerWords: decodeU32FixedArray(requireObjectKey(object, 'registerWords', label, `${label}.registerWords`), `${label}.registerWords`, GX_GPU_PCRTC_CONFIG_WORD_COUNT),
		presentWords: decodeU32FixedArray(requireObjectKey(object, 'presentWords', label, `${label}.presentWords`), `${label}.presentWords`, GX_GPU_PCRTC_CONFIG_WORD_COUNT),
		csrWord: requireBoundedU32(requireObjectKey(object, 'csrWord', label, `${label}.csrWord`), `${label}.csrWord`, 0, 0xffffffff),
		imrWord: requireBoundedU32(requireObjectKey(object, 'imrWord', label, `${label}.imrWord`), `${label}.imrWord`, 0, 0xffffffff),
		beamCycleOffset: requireI64(requireObjectKey(object, 'beamCycleOffset', label, `${label}.beamCycleOffset`), `${label}.beamCycleOffset`),
		beamRemainder: requireBoundedU32(requireObjectKey(object, 'beamRemainder', label, `${label}.beamRemainder`), `${label}.beamRemainder`, 0, 0xffffffff),
		beamHalfLine: requireBoundedU32(requireObjectKey(object, 'beamHalfLine', label, `${label}.beamHalfLine`), `${label}.beamHalfLine`, 0, 0xffffffff),
		nextHsyncHalfLine: requireBoundedU32(requireObjectKey(object, 'nextHsyncHalfLine', label, `${label}.nextHsyncHalfLine`), `${label}.nextHsyncHalfLine`, 0, 0xffffffff),
		verticalStage: requireBoundedU32(requireObjectKey(object, 'verticalStage', label, `${label}.verticalStage`), `${label}.verticalStage`, 0, 2),
		vblankActive: requireBooleanValue(requireObjectKey(object, 'vblankActive', label, `${label}.vblankActive`), `${label}.vblankActive`),
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
		gp0FifoWords: encodeVector(state.gp0FifoWords, (word) => word >>> 0),
		gp0DmaIngressWords: encodeVector(state.gp0DmaIngressWords, (word) => word >>> 0),
		gp0IngressPhase: state.gp0IngressPhase >>> 0,
		gp0IngressWordsRemaining: state.gp0IngressWordsRemaining >>> 0,
		gp0IngressPolylineWordsPerVertex: state.gp0IngressPolylineWordsPerVertex >>> 0,
		gp0IngressPolylinePayloadPhase: state.gp0IngressPolylinePayloadPhase >>> 0,
		pendingCommandCycles: state.pendingCommandCycles,
		pendingCommandTargetCount: state.pendingCommandTargetCount >>> 0,
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
		vramYAddressExtensionWord: state.vramYAddressExtensionWord >>> 0,
		presentStatusWord: state.presentStatusWord >>> 0,
		presentDisplayModeWord: state.presentDisplayModeWord >>> 0,
		presentDisplayStartWord: state.presentDisplayStartWord >>> 0,
		presentVramYAddressExtensionWord: state.presentVramYAddressExtensionWord >>> 0,
		presentHorizontalDisplayRangeWord: state.presentHorizontalDisplayRangeWord >>> 0,
		presentVerticalDisplayRangeWord: state.presentVerticalDisplayRangeWord >>> 0,
		pcrtc: encodeGxGpuPcrtcState(state.pcrtc),
		pcrtcPresentationPending: state.pcrtcPresentationPending,
		vramPresentationPending: state.vramPresentationPending,
		supervisorQuiesceRequested: state.supervisorQuiesceRequested,
		supervisorIngressQuiesceRequested: state.supervisorIngressQuiesceRequested,
		supervisorIngressStopped: state.supervisorIngressStopped,
		userContext: encodeGxGpuRegisterContextState(state.userContext),
		userIngressContext: encodeGxGpuIngressContextState(state.userIngressContext),
		commandBuffer: encodeGxGpuCommandBufferState(state.commandBuffer),
	};
}

function decodeGxGpuState(value: unknown, label: string): GxGpuState {
	const object = requireObject(value, label);
	const gp0CommandWordCount = requireBoundedU32(requireObjectKey(object, 'gp0CommandWordCount', label, `${label}.gp0CommandWordCount`), `${label}.gp0CommandWordCount`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	const commandBuffer = decodeGxGpuCommandBufferState(requireObjectKey(object, 'commandBuffer', label, `${label}.commandBuffer`), `${label}.commandBuffer`);
	return {
		gp0Word: requireBoundedU32(requireObjectKey(object, 'gp0Word', label, `${label}.gp0Word`), `${label}.gp0Word`, 0, 0xffffffff),
		gp1Word: requireBoundedU32(requireObjectKey(object, 'gp1Word', label, `${label}.gp1Word`), `${label}.gp1Word`, 0, 0xffffffff),
		displayModeWord: requireBoundedU32(requireObjectKey(object, 'displayModeWord', label, `${label}.displayModeWord`), `${label}.displayModeWord`, 0, 0xffffffff),
		statusWord: requireBoundedU32(requireObjectKey(object, 'statusWord', label, `${label}.statusWord`), `${label}.statusWord`, 0, 0xffffffff),
		gp0CommandWordCount,
		gp0CommandTargetWordCount: requireBoundedU32(requireObjectKey(object, 'gp0CommandTargetWordCount', label, `${label}.gp0CommandTargetWordCount`), `${label}.gp0CommandTargetWordCount`, 0, GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0CommandWords: decodeU32FixedArray(requireObjectKey(object, 'gp0CommandWords', label, `${label}.gp0CommandWords`), `${label}.gp0CommandWords`, gp0CommandWordCount),
		gp0FifoWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'gp0FifoWords', label, `${label}.gp0FifoWords`), `${label}.gp0FifoWords`, GX_GPU_COMMAND_FIFO_WORD_CAPACITY),
		gp0DmaIngressWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'gp0DmaIngressWords', label, `${label}.gp0DmaIngressWords`), `${label}.gp0DmaIngressWords`, GX_GPU_DMA_INGRESS_WORD_CAPACITY),
		gp0IngressPhase: requireBoundedU32(requireObjectKey(object, 'gp0IngressPhase', label, `${label}.gp0IngressPhase`), `${label}.gp0IngressPhase`, 0, GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD),
		gp0IngressWordsRemaining: requireBoundedU32(requireObjectKey(object, 'gp0IngressWordsRemaining', label, `${label}.gp0IngressWordsRemaining`), `${label}.gp0IngressWordsRemaining`, 0, GX_GPU_COMMAND_WORD_CAPACITY),
		gp0IngressPolylineWordsPerVertex: requireBoundedU32(requireObjectKey(object, 'gp0IngressPolylineWordsPerVertex', label, `${label}.gp0IngressPolylineWordsPerVertex`), `${label}.gp0IngressPolylineWordsPerVertex`, 0, 2),
		gp0IngressPolylinePayloadPhase: requireBoundedU32(requireObjectKey(object, 'gp0IngressPolylinePayloadPhase', label, `${label}.gp0IngressPolylinePayloadPhase`), `${label}.gp0IngressPolylinePayloadPhase`, 0, 1),
		pendingCommandCycles: requireBoundedU32(requireObjectKey(object, 'pendingCommandCycles', label, `${label}.pendingCommandCycles`), `${label}.pendingCommandCycles`, 0, 0xffffffff),
		pendingCommandTargetCount: requireBoundedU32(requireObjectKey(object, 'pendingCommandTargetCount', label, `${label}.pendingCommandTargetCount`), `${label}.pendingCommandTargetCount`, 0, commandBuffer.commandCount),
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
		vramYAddressExtensionWord: requireBoundedU32(requireObjectKey(object, 'vramYAddressExtensionWord', label, `${label}.vramYAddressExtensionWord`), `${label}.vramYAddressExtensionWord`, 0, 0xffffffff),
		presentStatusWord: requireBoundedU32(requireObjectKey(object, 'presentStatusWord', label, `${label}.presentStatusWord`), `${label}.presentStatusWord`, 0, 0xffffffff),
		presentDisplayModeWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayModeWord', label, `${label}.presentDisplayModeWord`), `${label}.presentDisplayModeWord`, 0, 0xffffffff),
		presentDisplayStartWord: requireBoundedU32(requireObjectKey(object, 'presentDisplayStartWord', label, `${label}.presentDisplayStartWord`), `${label}.presentDisplayStartWord`, 0, 0xffffffff),
		presentVramYAddressExtensionWord: requireBoundedU32(requireObjectKey(object, 'presentVramYAddressExtensionWord', label, `${label}.presentVramYAddressExtensionWord`), `${label}.presentVramYAddressExtensionWord`, 0, 1),
		presentHorizontalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentHorizontalDisplayRangeWord', label, `${label}.presentHorizontalDisplayRangeWord`), `${label}.presentHorizontalDisplayRangeWord`, 0, 0xffffffff),
		presentVerticalDisplayRangeWord: requireBoundedU32(requireObjectKey(object, 'presentVerticalDisplayRangeWord', label, `${label}.presentVerticalDisplayRangeWord`), `${label}.presentVerticalDisplayRangeWord`, 0, 0xffffffff),
		pcrtc: decodeGxGpuPcrtcState(requireObjectKey(object, 'pcrtc', label, `${label}.pcrtc`), `${label}.pcrtc`),
		pcrtcPresentationPending: requireBooleanValue(requireObjectKey(object, 'pcrtcPresentationPending', label, `${label}.pcrtcPresentationPending`), `${label}.pcrtcPresentationPending`),
		vramPresentationPending: requireBooleanValue(requireObjectKey(object, 'vramPresentationPending', label, `${label}.vramPresentationPending`), `${label}.vramPresentationPending`),
		supervisorQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorQuiesceRequested', label, `${label}.supervisorQuiesceRequested`), `${label}.supervisorQuiesceRequested`),
		supervisorIngressQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorIngressQuiesceRequested', label, `${label}.supervisorIngressQuiesceRequested`), `${label}.supervisorIngressQuiesceRequested`),
		supervisorIngressStopped: requireBooleanValue(requireObjectKey(object, 'supervisorIngressStopped', label, `${label}.supervisorIngressStopped`), `${label}.supervisorIngressStopped`),
		userContext: decodeGxGpuRegisterContextState(requireObjectKey(object, 'userContext', label, `${label}.userContext`), `${label}.userContext`),
		userIngressContext: decodeGxGpuIngressContextState(requireObjectKey(object, 'userIngressContext', label, `${label}.userIngressContext`), `${label}.userIngressContext`),
		commandBuffer,
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
		plusRegisterWords: encodeVector(state.plusRegisterWords, (word) => word >>> 0),
		mac0: state.mac0,
		mac1: state.mac1,
		mac2: state.mac2,
		mac3: state.mac3,
		currentSf: state.currentSf >>> 0,
		lastCycles: state.lastCycles >>> 0,
		plusPendingCycles: state.plusPendingCycles >>> 0,
		plusInterlockArmed: state.plusInterlockArmed,
		plusPendingResultXy: state.plusPendingResultXy >>> 0,
		plusPendingResultZ: state.plusPendingResultZ >>> 0,
		plusPendingFlag: state.plusPendingFlag >>> 0,
	};
}

function decodeGxGteState(value: unknown, label: string): GxGteState {
	const object = requireObject(value, label);
	return {
		dataRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'dataRegisterWords', label, `${label}.dataRegisterWords`), `${label}.dataRegisterWords`, GX_GTE_DATA_REGISTER_COUNT),
		controlRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'controlRegisterWords', label, `${label}.controlRegisterWords`), `${label}.controlRegisterWords`, GX_GTE_CONTROL_REGISTER_COUNT),
		plusRegisterWords: decodeU32FixedArray(requireObjectKey(object, 'plusRegisterWords', label, `${label}.plusRegisterWords`), `${label}.plusRegisterWords`, GX_GTE_PLUS_REGISTER_COUNT),
		mac0: requireI64(requireObjectKey(object, 'mac0', label, `${label}.mac0`), `${label}.mac0`),
		mac1: requireI64(requireObjectKey(object, 'mac1', label, `${label}.mac1`), `${label}.mac1`),
		mac2: requireI64(requireObjectKey(object, 'mac2', label, `${label}.mac2`), `${label}.mac2`),
		mac3: requireI64(requireObjectKey(object, 'mac3', label, `${label}.mac3`), `${label}.mac3`),
		currentSf: requireBoundedU32(requireObjectKey(object, 'currentSf', label, `${label}.currentSf`), `${label}.currentSf`, 0, 0xffffffff),
		lastCycles: requireBoundedU32(requireObjectKey(object, 'lastCycles', label, `${label}.lastCycles`), `${label}.lastCycles`, 0, 0xffffffff),
		plusPendingCycles: requireBoundedU32(requireObjectKey(object, 'plusPendingCycles', label, `${label}.plusPendingCycles`), `${label}.plusPendingCycles`, 0, 0xffffffff),
		plusInterlockArmed: requireBooleanValue(requireObjectKey(object, 'plusInterlockArmed', label, `${label}.plusInterlockArmed`), `${label}.plusInterlockArmed`),
		plusPendingResultXy: requireBoundedU32(requireObjectKey(object, 'plusPendingResultXy', label, `${label}.plusPendingResultXy`), `${label}.plusPendingResultXy`, 0, 0xffffffff),
		plusPendingResultZ: requireBoundedU32(requireObjectKey(object, 'plusPendingResultZ', label, `${label}.plusPendingResultZ`), `${label}.plusPendingResultZ`, 0, 0xffffffff),
		plusPendingFlag: requireBoundedU32(requireObjectKey(object, 'plusPendingFlag', label, `${label}.plusPendingFlag`), `${label}.plusPendingFlag`, 0, 0xffffffff),
	};
}

function encodeApuBiquadFilterState(state: ApuBiquadFilterState): ApuBiquadFilterState {
	return {
		l1: state.l1,
		l2: state.l2,
		r1: state.r1,
		r2: state.r2,
	};
}

function decodeApuBiquadFilterState(value: unknown, label: string): ApuBiquadFilterState {
	const object = requireObject(value, label);
	return {
		l1: requireI32(requireObjectKey(object, 'l1', label, `${label}.l1`), `${label}.l1`),
		l2: requireI32(requireObjectKey(object, 'l2', label, `${label}.l2`), `${label}.l2`),
		r1: requireI32(requireObjectKey(object, 'r1', label, `${label}.r1`), `${label}.r1`),
		r2: requireI32(requireObjectKey(object, 'r2', label, `${label}.r2`), `${label}.r2`),
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
		previousDecodedFrame: state.previousDecodedFrame,
		previousDecodedLeft: state.previousDecodedLeft,
		previousDecodedRight: state.previousDecodedRight,
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
		decodedLeft: requireI16(requireObjectKey(object, 'decodedLeft', label, `${label}.decodedLeft`), `${label}.decodedLeft`),
		decodedRight: requireI16(requireObjectKey(object, 'decodedRight', label, `${label}.decodedRight`), `${label}.decodedRight`),
		previousDecodedFrame: requireI64(requireObjectKey(object, 'previousDecodedFrame', label, `${label}.previousDecodedFrame`), `${label}.previousDecodedFrame`),
		previousDecodedLeft: requireI16(requireObjectKey(object, 'previousDecodedLeft', label, `${label}.previousDecodedLeft`), `${label}.previousDecodedLeft`),
		previousDecodedRight: requireI16(requireObjectKey(object, 'previousDecodedRight', label, `${label}.previousDecodedRight`), `${label}.previousDecodedRight`),
	};
}

function encodeApuOutputVoiceState(state: ApuOutputVoiceState): ApuOutputVoiceState {
	return {
		slot: state.slot,
		sourceCartridgeSlot: state.sourceCartridgeSlot,
		cursorQ16: state.cursorQ16,
		phaseRemainder: state.phaseRemainder,
		gainQ12: state.gainQ12,
		fadeStepQ12: state.fadeStepQ12,
		fadeStepRemainder: state.fadeStepRemainder,
		fadeError: state.fadeError,
		fadeSamplesRemaining: state.fadeSamplesRemaining,
		fadeSamplesTotal: state.fadeSamplesTotal,
		filter: encodeApuBiquadFilterState(state.filter),
		badp: encodeApuBadpDecoderState(state.badp),
	};
}

function decodeApuOutputVoiceState(value: unknown, label: string): ApuOutputVoiceState {
	const object = requireObject(value, label);
	return {
		slot: requireBoundedU32(requireObjectKey(object, 'slot', label, `${label}.slot`), `${label}.slot`, 0, APU_SLOT_COUNT - 1),
		sourceCartridgeSlot: requireBoundedU32(
			requireObjectKey(object, 'sourceCartridgeSlot', label, `${label}.sourceCartridgeSlot`),
			`${label}.sourceCartridgeSlot`,
			0,
			CARTRIDGE_SLOT_COUNT - 1,
		),
		cursorQ16: requireI64(requireObjectKey(object, 'cursorQ16', label, `${label}.cursorQ16`), `${label}.cursorQ16`),
		phaseRemainder: requireI32(requireObjectKey(object, 'phaseRemainder', label, `${label}.phaseRemainder`), `${label}.phaseRemainder`),
		gainQ12: requireI32(requireObjectKey(object, 'gainQ12', label, `${label}.gainQ12`), `${label}.gainQ12`),
		fadeStepQ12: requireI32(requireObjectKey(object, 'fadeStepQ12', label, `${label}.fadeStepQ12`), `${label}.fadeStepQ12`),
		fadeStepRemainder: requireI32(requireObjectKey(object, 'fadeStepRemainder', label, `${label}.fadeStepRemainder`), `${label}.fadeStepRemainder`),
		fadeError: requireBoundedU32(requireObjectKey(object, 'fadeError', label, `${label}.fadeError`), `${label}.fadeError`, 0, 0xffffffff),
		fadeSamplesRemaining: requireBoundedU32(requireObjectKey(object, 'fadeSamplesRemaining', label, `${label}.fadeSamplesRemaining`), `${label}.fadeSamplesRemaining`, 0, 0xffffffff),
		fadeSamplesTotal: requireBoundedU32(requireObjectKey(object, 'fadeSamplesTotal', label, `${label}.fadeSamplesTotal`), `${label}.fadeSamplesTotal`, 0, 0xffffffff),
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

function encodeApuSampleTransferState(state: ApuSampleTransferState): ApuSampleTransferState {
	return {
		fifoWords: encodeVector(state.fifoWords, (word) => word >>> 0),
		fifoReadIndex: state.fifoReadIndex,
		fifoWriteIndex: state.fifoWriteIndex,
		fifoCount: state.fifoCount,
		transferAddressWord: state.transferAddressWord,
		transferDataWord: state.transferDataWord,
		transferControlWord: state.transferControlWord,
		currentAddress: state.currentAddress,
		timingCarry: state.timingCarry,
		scheduledWords: state.scheduledWords,
		scheduledCycles: state.scheduledCycles,
	};
}

function decodeApuSampleTransferState(value: unknown, label: string): ApuSampleTransferState {
	const object = requireObject(value, label);
	return {
		fifoWords: decodeU32FixedArray(requireObjectKey(object, 'fifoWords', label, `${label}.fifoWords`), `${label}.fifoWords`, APU_TRANSFER_FIFO_WORD_CAPACITY),
		fifoReadIndex: requireBoundedU32(requireObjectKey(object, 'fifoReadIndex', label, `${label}.fifoReadIndex`), `${label}.fifoReadIndex`, 0, APU_TRANSFER_FIFO_WORD_CAPACITY - 1),
		fifoWriteIndex: requireBoundedU32(requireObjectKey(object, 'fifoWriteIndex', label, `${label}.fifoWriteIndex`), `${label}.fifoWriteIndex`, 0, APU_TRANSFER_FIFO_WORD_CAPACITY - 1),
		fifoCount: requireBoundedU32(requireObjectKey(object, 'fifoCount', label, `${label}.fifoCount`), `${label}.fifoCount`, 0, APU_TRANSFER_FIFO_WORD_CAPACITY),
		transferAddressWord: requireBoundedU32(requireObjectKey(object, 'transferAddressWord', label, `${label}.transferAddressWord`), `${label}.transferAddressWord`, 0, 0xffffffff),
		transferDataWord: requireBoundedU32(requireObjectKey(object, 'transferDataWord', label, `${label}.transferDataWord`), `${label}.transferDataWord`, 0, 0xffffffff),
		transferControlWord: requireBoundedU32(requireObjectKey(object, 'transferControlWord', label, `${label}.transferControlWord`), `${label}.transferControlWord`, 0, 0xffffffff),
		currentAddress: requireBoundedU32(requireObjectKey(object, 'currentAddress', label, `${label}.currentAddress`), `${label}.currentAddress`, 0, APU_SAMPLE_RAM_ADDRESS_MASK),
		timingCarry: requireI64(requireObjectKey(object, 'timingCarry', label, `${label}.timingCarry`), `${label}.timingCarry`),
		scheduledWords: requireBoundedU32(requireObjectKey(object, 'scheduledWords', label, `${label}.scheduledWords`), `${label}.scheduledWords`, 0, APU_TRANSFER_FIFO_WORD_CAPACITY),
		scheduledCycles: requireI64(requireObjectKey(object, 'scheduledCycles', label, `${label}.scheduledCycles`), `${label}.scheduledCycles`),
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
		sampleRam: state.sampleRam,
		sampleTransfer: encodeApuSampleTransferState(state.sampleTransfer),
		output: encodeApuOutputState(state.output),
		sampleCarry: state.sampleCarry,
		sampleSequence: state.sampleSequence,
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
		sampleRam: requireBinaryFixedLength(requireObjectKey(object, 'sampleRam', label, 'machine.audio.sampleRam'), 'machine.audio.sampleRam', APU_SAMPLE_RAM_BYTES),
		sampleTransfer: decodeApuSampleTransferState(requireObjectKey(object, 'sampleTransfer', label, 'machine.audio.sampleTransfer'), 'machine.audio.sampleTransfer'),
		output: decodeApuOutputState(requireObjectKey(object, 'output', label, 'machine.audio.output'), 'machine.audio.output'),
		sampleCarry: requireI64(requireObjectKey(object, 'sampleCarry', label, 'machine.audio.sampleCarry'), 'machine.audio.sampleCarry'),
		sampleSequence: requireI64(requireObjectKey(object, 'sampleSequence', label, 'machine.audio.sampleSequence'), 'machine.audio.sampleSequence'),
		apuStatus: requireBoundedU32(requireObjectKey(object, 'apuStatus', label, 'machine.audio.apuStatus'), 'machine.audio.apuStatus', 0, 0xffffffff),
		apuFaultCode: requireBoundedU32(requireObjectKey(object, 'apuFaultCode', label, 'machine.audio.apuFaultCode'), 'machine.audio.apuFaultCode', 0, 0xffffffff),
		apuFaultDetail: requireBoundedU32(requireObjectKey(object, 'apuFaultDetail', label, 'machine.audio.apuFaultDetail'), 'machine.audio.apuFaultDetail', 0, 0xffffffff),
	};
}

function encodeDmaChannelState(state: DmaChannelState): DmaChannelState {
	return {
		readAddressWord: state.readAddressWord,
		writeAddressWord: state.writeAddressWord,
		transferCountWord: state.transferCountWord,
		controlWord: state.controlWord,
		statusWord: state.statusWord,
	};
}

function decodeDmaChannelState(value: unknown, label: string): DmaChannelState {
	const object = requireObject(value, label);
	return {
		readAddressWord: requireBoundedU32(requireObjectKey(object, 'readAddressWord', label, `${label}.readAddressWord`), `${label}.readAddressWord`, 0, 0xffffffff),
		writeAddressWord: requireBoundedU32(requireObjectKey(object, 'writeAddressWord', label, `${label}.writeAddressWord`), `${label}.writeAddressWord`, 0, 0xffffffff),
		transferCountWord: requireBoundedU32(requireObjectKey(object, 'transferCountWord', label, `${label}.transferCountWord`), `${label}.transferCountWord`, 0, 0xffffffff),
		controlWord: requireBoundedU32(requireObjectKey(object, 'controlWord', label, `${label}.controlWord`), `${label}.controlWord`, 0, 0xffffffff),
		statusWord: requireBoundedU32(requireObjectKey(object, 'statusWord', label, `${label}.statusWord`), `${label}.statusWord`, 0, 0xffffffff),
	};
}

function encodeDmaControllerState(state: DmaControllerState): DmaControllerState {
	return {
		channels: [encodeDmaChannelState(state.channels[0]), encodeDmaChannelState(state.channels[1])],
		activeChannel: state.activeChannel,
		nextChannel: state.nextChannel,
		scheduledBlockWords: state.scheduledBlockWords,
		scheduledBlockCycles: state.scheduledBlockCycles,
		scheduledReadAddressWord: state.scheduledReadAddressWord,
		scheduledWriteAddressWord: state.scheduledWriteAddressWord,
		scheduledTransferCountWord: state.scheduledTransferCountWord,
		scheduledControlWord: state.scheduledControlWord,
		supervisorQuiesceRequested: state.supervisorQuiesceRequested,
		supervisorAdmissionQuiesceRequested: state.supervisorAdmissionQuiesceRequested,
		userChannels: [encodeDmaChannelState(state.userChannels[0]), encodeDmaChannelState(state.userChannels[1])],
		userNextChannel: state.userNextChannel,
	};
}

function decodeDmaControllerState(value: unknown, label: string): DmaControllerState {
	const object = requireObject(value, label);
	const channels = requireArray(requireObjectKey(object, 'channels', label, `${label}.channels`), `${label}.channels`);
	const userChannels = requireArray(requireObjectKey(object, 'userChannels', label, `${label}.userChannels`), `${label}.userChannels`);
	if (channels.length !== IO_DMA_CHANNEL_COUNT || userChannels.length !== IO_DMA_CHANNEL_COUNT) {
		throw new Error(`${label} must contain two DMA channels.`);
	}
	return {
		channels: [decodeDmaChannelState(channels[0], `${label}.channels[0]`), decodeDmaChannelState(channels[1], `${label}.channels[1]`)],
		activeChannel: requireBoundedU32(requireObjectKey(object, 'activeChannel', label, `${label}.activeChannel`), `${label}.activeChannel`, 0, IO_DMA_CHANNEL_COUNT),
		nextChannel: requireBoundedU32(requireObjectKey(object, 'nextChannel', label, `${label}.nextChannel`), `${label}.nextChannel`, 0, IO_DMA_CHANNEL_COUNT - 1),
		scheduledBlockWords: requireBoundedU32(requireObjectKey(object, 'scheduledBlockWords', label, `${label}.scheduledBlockWords`), `${label}.scheduledBlockWords`, 0, 16),
		scheduledBlockCycles: requireI64(requireObjectKey(object, 'scheduledBlockCycles', label, `${label}.scheduledBlockCycles`), `${label}.scheduledBlockCycles`),
		scheduledReadAddressWord: requireBoundedU32(requireObjectKey(object, 'scheduledReadAddressWord', label, `${label}.scheduledReadAddressWord`), `${label}.scheduledReadAddressWord`, 0, 0xffffffff),
		scheduledWriteAddressWord: requireBoundedU32(requireObjectKey(object, 'scheduledWriteAddressWord', label, `${label}.scheduledWriteAddressWord`), `${label}.scheduledWriteAddressWord`, 0, 0xffffffff),
		scheduledTransferCountWord: requireBoundedU32(requireObjectKey(object, 'scheduledTransferCountWord', label, `${label}.scheduledTransferCountWord`), `${label}.scheduledTransferCountWord`, 0, 0xffffffff),
		scheduledControlWord: requireBoundedU32(requireObjectKey(object, 'scheduledControlWord', label, `${label}.scheduledControlWord`), `${label}.scheduledControlWord`, 0, 0xffffffff),
		supervisorQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorQuiesceRequested', label, `${label}.supervisorQuiesceRequested`), `${label}.supervisorQuiesceRequested`),
		supervisorAdmissionQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorAdmissionQuiesceRequested', label, `${label}.supervisorAdmissionQuiesceRequested`), `${label}.supervisorAdmissionQuiesceRequested`),
		userChannels: [decodeDmaChannelState(userChannels[0], `${label}.userChannels[0]`), decodeDmaChannelState(userChannels[1], `${label}.userChannels[1]`)],
		userNextChannel: requireBoundedU32(requireObjectKey(object, 'userNextChannel', label, `${label}.userNextChannel`), `${label}.userNextChannel`, 0, IO_DMA_CHANNEL_COUNT - 1),
	};
}

function encodeImgDecControllerState(state: ImgDecControllerState): ImgDecControllerState {
	return {
		inputWordCountWord: state.inputWordCountWord,
		textureDestinationWord: state.textureDestinationWord,
		textureSizeWord: state.textureSizeWord,
		clutDestinationWord: state.clutDestinationWord,
		controlWord: state.controlWord,
		statusWord: state.statusWord,
		dataWord: state.dataWord,
		inputWordsReceived: state.inputWordsReceived,
		decodedWordCount: state.decodedWordCount,
		textureWordCount: state.textureWordCount,
		clutWordCount: state.clutWordCount,
		outputWordsRead: state.outputWordsRead,
		decodePhase: state.decodePhase,
		outputStage: state.outputStage,
		runWordsRemaining: state.runWordsRemaining,
		repeatWord: state.repeatWord,
		backReferenceDistance: state.backReferenceDistance,
		supervisorQuiesceRequested: state.supervisorQuiesceRequested,
		inputWords: encodeVector(state.inputWords, (word) => word >>> 0),
		outputWords: encodeVector(state.outputWords, (word) => word >>> 0),
		historyWords: encodeVector(state.historyWords, (word) => word >>> 0),
		scheduledDecodeWords: state.scheduledDecodeWords,
		scheduledDecodeCycles: state.scheduledDecodeCycles,
	};
}

function decodeImgDecControllerState(value: unknown, label: string): ImgDecControllerState {
	const object = requireObject(value, label);
	return {
		inputWordCountWord: requireBoundedU32(requireObjectKey(object, 'inputWordCountWord', label, `${label}.inputWordCountWord`), `${label}.inputWordCountWord`, 0, 0xffffffff),
		textureDestinationWord: requireBoundedU32(requireObjectKey(object, 'textureDestinationWord', label, `${label}.textureDestinationWord`), `${label}.textureDestinationWord`, 0, 0xffffffff),
		textureSizeWord: requireBoundedU32(requireObjectKey(object, 'textureSizeWord', label, `${label}.textureSizeWord`), `${label}.textureSizeWord`, 0, 0xffffffff),
		clutDestinationWord: requireBoundedU32(requireObjectKey(object, 'clutDestinationWord', label, `${label}.clutDestinationWord`), `${label}.clutDestinationWord`, 0, 0xffffffff),
		controlWord: requireBoundedU32(requireObjectKey(object, 'controlWord', label, `${label}.controlWord`), `${label}.controlWord`, 0, 0xffffffff),
		statusWord: requireBoundedU32(requireObjectKey(object, 'statusWord', label, `${label}.statusWord`), `${label}.statusWord`, 0, 0xffffffff),
		dataWord: requireBoundedU32(requireObjectKey(object, 'dataWord', label, `${label}.dataWord`), `${label}.dataWord`, 0, 0xffffffff),
		inputWordsReceived: requireBoundedU32(requireObjectKey(object, 'inputWordsReceived', label, `${label}.inputWordsReceived`), `${label}.inputWordsReceived`, 0, 0xffffffff),
		decodedWordCount: requireBoundedU32(requireObjectKey(object, 'decodedWordCount', label, `${label}.decodedWordCount`), `${label}.decodedWordCount`, 0, 0xffffffff),
		textureWordCount: requireBoundedU32(requireObjectKey(object, 'textureWordCount', label, `${label}.textureWordCount`), `${label}.textureWordCount`, 0, 0xffffffff),
		clutWordCount: requireBoundedU32(requireObjectKey(object, 'clutWordCount', label, `${label}.clutWordCount`), `${label}.clutWordCount`, 0, 0xffffffff),
		outputWordsRead: requireBoundedU32(requireObjectKey(object, 'outputWordsRead', label, `${label}.outputWordsRead`), `${label}.outputWordsRead`, 0, 0xffffffff),
		decodePhase: requireBoundedU32(requireObjectKey(object, 'decodePhase', label, `${label}.decodePhase`), `${label}.decodePhase`, 0, 8),
		outputStage: requireBoundedU32(requireObjectKey(object, 'outputStage', label, `${label}.outputStage`), `${label}.outputStage`, 0, 4),
		runWordsRemaining: requireBoundedU32(requireObjectKey(object, 'runWordsRemaining', label, `${label}.runWordsRemaining`), `${label}.runWordsRemaining`, 0, 0xffffffff),
		repeatWord: requireBoundedU32(requireObjectKey(object, 'repeatWord', label, `${label}.repeatWord`), `${label}.repeatWord`, 0, 0xffffffff),
		backReferenceDistance: requireBoundedU32(requireObjectKey(object, 'backReferenceDistance', label, `${label}.backReferenceDistance`), `${label}.backReferenceDistance`, 0, IMGDEC_HISTORY_WORD_CAPACITY),
		supervisorQuiesceRequested: requireBooleanValue(requireObjectKey(object, 'supervisorQuiesceRequested', label, `${label}.supervisorQuiesceRequested`), `${label}.supervisorQuiesceRequested`),
		inputWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'inputWords', label, `${label}.inputWords`), `${label}.inputWords`, IMGDEC_INPUT_FIFO_WORD_CAPACITY),
		outputWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'outputWords', label, `${label}.outputWords`), `${label}.outputWords`, IMGDEC_OUTPUT_FIFO_WORD_CAPACITY),
		historyWords: decodeU32VectorWithMaxLength(requireObjectKey(object, 'historyWords', label, `${label}.historyWords`), `${label}.historyWords`, IMGDEC_HISTORY_WORD_CAPACITY),
		scheduledDecodeWords: requireBoundedU32(requireObjectKey(object, 'scheduledDecodeWords', label, `${label}.scheduledDecodeWords`), `${label}.scheduledDecodeWords`, 0, IMGDEC_DECODE_BATCH_WORDS),
		scheduledDecodeCycles: requireI64(requireObjectKey(object, 'scheduledDecodeCycles', label, `${label}.scheduledDecodeCycles`), `${label}.scheduledDecodeCycles`),
	};
}

function encodeSystemControllerState(state: SystemControllerState): SystemControllerState {
	return {
		resetRequested: state.resetRequested,
		supervisorPhase: state.supervisorPhase,
		supervisorTransitionTarget: state.supervisorTransitionTarget,
		supervisorResumable: state.supervisorResumable,
		supervisorExitRequested: state.supervisorExitRequested,
		printBuffer: state.printBuffer,
		printReadIndex: state.printReadIndex,
		printByteCount: state.printByteCount,
	};
}

function decodeSystemControllerState(value: unknown, label: string): SystemControllerState {
	const object = requireObject(value, label);
	return {
		resetRequested: requireBooleanValue(requireObjectKey(object, 'resetRequested', label, `${label}.resetRequested`), `${label}.resetRequested`),
		supervisorPhase: requireBoundedU32(requireObjectKey(object, 'supervisorPhase', label, `${label}.supervisorPhase`), `${label}.supervisorPhase`, 0, SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE),
		supervisorTransitionTarget: requireBoundedU32(requireObjectKey(object, 'supervisorTransitionTarget', label, `${label}.supervisorTransitionTarget`), `${label}.supervisorTransitionTarget`, 0, SYSTEM_SUPERVISOR_TARGET_SUPERVISOR),
		supervisorResumable: requireBooleanValue(requireObjectKey(object, 'supervisorResumable', label, `${label}.supervisorResumable`), `${label}.supervisorResumable`),
		supervisorExitRequested: requireBooleanValue(requireObjectKey(object, 'supervisorExitRequested', label, `${label}.supervisorExitRequested`), `${label}.supervisorExitRequested`),
		printBuffer: requireBinaryFixedLength(requireObjectKey(object, 'printBuffer', label, `${label}.printBuffer`), `${label}.printBuffer`, SYS_PRINT_BUFFER_BYTES),
		printReadIndex: requireBoundedU32(requireObjectKey(object, 'printReadIndex', label, `${label}.printReadIndex`), `${label}.printReadIndex`, 0, SYS_PRINT_BUFFER_BYTES - 1),
		printByteCount: requireBoundedU32(requireObjectKey(object, 'printByteCount', label, `${label}.printByteCount`), `${label}.printByteCount`, 0, SYS_PRINT_BUFFER_BYTES),
	};
}

function encodeMachineSaveState(state: MachineSaveState): MachineSaveState {
	return {
		memory: encodeMemorySaveState(state.memory),
		cartridge: encodeCartridgeControllerState(state.cartridge),
		dma: encodeDmaControllerState(state.dma),
		geometry: encodeGeometryControllerState(state.geometry),
		gxGpu: encodeGxGpuSaveState(state.gxGpu),
		gxGte: encodeGxGteState(state.gxGte),
		irq: encodeIrqControllerState(state.irq),
		audio: encodeAudioControllerState(state.audio),
		stringPool: encodeStringPoolState(state.stringPool),
		input: encodeInputControllerState(state.input),
		imgDec: encodeImgDecControllerState(state.imgDec),
		systemControl: encodeSystemControllerState(state.systemControl),
	};
}

function decodeMachineSaveState(value: unknown, label: string): MachineSaveState {
	const object = requireObject(value, label);
	return {
		memory: decodeMemorySaveState(requireObjectKey(object, 'memory', label, 'machineState.machine.memory'), 'machineState.machine.memory'),
		cartridge: decodeCartridgeControllerState(requireObjectKey(object, 'cartridge', label, 'machineState.machine.cartridge'), 'machineState.machine.cartridge'),
		dma: decodeDmaControllerState(requireObjectKey(object, 'dma', label, 'machineState.machine.dma'), 'machineState.machine.dma'),
		geometry: decodeGeometryControllerState(requireObjectKey(object, 'geometry', label, 'machineState.machine.geometry'), 'machineState.machine.geometry'),
		gxGpu: decodeGxGpuSaveState(requireObjectKey(object, 'gxGpu', label, 'machineState.machine.gxGpu'), 'machineState.machine.gxGpu'),
		gxGte: decodeGxGteState(requireObjectKey(object, 'gxGte', label, 'machineState.machine.gxGte'), 'machineState.machine.gxGte'),
		irq: decodeIrqControllerState(requireObjectKey(object, 'irq', label, 'machineState.machine.irq'), 'machineState.machine.irq'),
		audio: decodeAudioControllerState(requireObjectKey(object, 'audio', label, 'machineState.machine.audio'), 'machineState.machine.audio'),
		stringPool: decodeStringPoolState(requireObjectKey(object, 'stringPool', label, 'machineState.machine.stringPool'), 'machineState.machine.stringPool'),
		input: decodeInputControllerState(requireObjectKey(object, 'input', label, 'machineState.machine.input'), 'machineState.machine.input'),
		imgDec: decodeImgDecControllerState(requireObjectKey(object, 'imgDec', label, 'machineState.machine.imgDec'), 'machineState.machine.imgDec'),
		systemControl: decodeSystemControllerState(requireObjectKey(object, 'systemControl', label, 'machineState.machine.systemControl'), 'machineState.machine.systemControl'),
	};
}

function encodeRuntimeSaveMachineState(state: RuntimeSaveMachineState): RuntimeSaveMachineState {
	return {
		machine: encodeMachineSaveState(state.machine),
		frameScheduler: encodeFrameSchedulerState(state.frameScheduler),
		frameLoop: encodeFrameLoopState(state.frameLoop),
		schedulerNowCycles: state.schedulerNowCycles,
	};
}

function decodeRuntimeSaveMachineState(value: unknown, label: string): RuntimeSaveMachineState {
	const object = requireObject(value, label);
	return {
		machine: decodeMachineSaveState(requireObjectKey(object, 'machine', label, 'machineState.machine'), 'machineState.machine'),
		frameScheduler: decodeFrameSchedulerState(requireObjectKey(object, 'frameScheduler', label, 'machineState.frameScheduler'), 'machineState.frameScheduler'),
		frameLoop: decodeFrameLoopState(requireObjectKey(object, 'frameLoop', label, 'machineState.frameLoop'), 'machineState.frameLoop'),
		schedulerNowCycles: requireI64(requireObjectKey(object, 'schedulerNowCycles', label, 'machineState.schedulerNowCycles'), 'machineState.schedulerNowCycles'),
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
				functionAddress: state.functionAddress,
				canonical: state.canonical,
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
				functionAddress: requireObjectKey(object, 'functionAddress', label, 'cpuObjectState.functionAddress') as number,
				canonical: requireObjectKey(object, 'canonical', label, 'cpuObjectState.canonical') as boolean,
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
		functionAddress: state.functionAddress,
		pc: state.pc,
		closureRef: state.closureRef,
		registers: encodeVector(state.registers, encodeCpuValueState),
		varargs: encodeVector(state.varargs, encodeCpuValueState),
		returnBase: state.returnBase,
		returnCount: state.returnCount,
		top: state.top,
		returnToCompletionLatch: state.returnToCompletionLatch,
		callSitePc: state.callSitePc,
		isExceptionFrame: state.isExceptionFrame,
		isNonMaskableExceptionFrame: state.isNonMaskableExceptionFrame,
	};
}

function decodeCpuFrameState(value: unknown, label: string): CpuFrameState {
	const object = requireObject(value, label);
	return {
		functionAddress: requireObjectKey(object, 'functionAddress', label, 'cpuFrameState.functionAddress') as number,
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
		returnToCompletionLatch: requireObjectKey(object, 'returnToCompletionLatch', label, 'cpuFrameState.returnToCompletionLatch') as boolean,
		callSitePc: requireObjectKey(object, 'callSitePc', label, 'cpuFrameState.callSitePc') as number,
		isExceptionFrame: requireObjectKey(object, 'isExceptionFrame', label, 'cpuFrameState.isExceptionFrame') as boolean,
		isNonMaskableExceptionFrame: requireObjectKey(object, 'isNonMaskableExceptionFrame', label, 'cpuFrameState.isNonMaskableExceptionFrame') as boolean,
	};
}

function encodeCpuProtectedCallState(state: CpuProtectedCallState): CpuProtectedCallState {
	return {
		kind: state.kind,
		callerFrameIndex: state.callerFrameIndex,
		targetFrameIndex: state.targetFrameIndex,
		returnsToProtectedParent: state.returnsToProtectedParent,
		callBase: state.callBase,
		returnCount: state.returnCount,
		handlerRegister: state.handlerRegister,
	};
}

function decodeCpuProtectedCallState(value: unknown, label: string): CpuProtectedCallState {
	const object = requireObject(value, label);
	return {
		kind: requireObjectKey(object, 'kind', label, 'cpuProtectedCallState.kind') as CpuProtectedCallState['kind'],
		callerFrameIndex: requireObjectKey(object, 'callerFrameIndex', label, 'cpuProtectedCallState.callerFrameIndex') as number,
		targetFrameIndex: requireObjectKey(object, 'targetFrameIndex', label, 'cpuProtectedCallState.targetFrameIndex') as number,
		returnsToProtectedParent: requireObjectKey(object, 'returnsToProtectedParent', label, 'cpuProtectedCallState.returnsToProtectedParent') as boolean,
		callBase: requireObjectKey(object, 'callBase', label, 'cpuProtectedCallState.callBase') as number,
		returnCount: requireObjectKey(object, 'returnCount', label, 'cpuProtectedCallState.returnCount') as number,
		handlerRegister: requireObjectKey(object, 'handlerRegister', label, 'cpuProtectedCallState.handlerRegister') as number,
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
		executionCartridgeSlot: state.executionCartridgeSlot,
		systemGlobals: encodeVector(state.systemGlobals, encodeCpuRootValueState),
		globals: encodeVector(state.globals, encodeCpuRootValueState),
		frames: encodeVector(state.frames, encodeCpuFrameState),
		protectedCalls: encodeVector(state.protectedCalls, encodeCpuProtectedCallState),
		completionValues: encodeVector(state.completionValues, encodeCpuValueState),
		objects: encodeVector(state.objects, encodeCpuObjectState),
		openUpvalues: encodeVector(state.openUpvalues, (value) => value),
		lastExecutionDomainId: state.lastExecutionDomainId,
		lastPc: state.lastPc,
		instructionBudgetRemaining: state.instructionBudgetRemaining,
		haltedUntilIrq: state.haltedUntilIrq,
		interruptEventPending: state.interruptEventPending,
		memoryWriteBlocked: state.memoryWriteBlocked,
		memoryWriteBlockedAddress: state.memoryWriteBlockedAddress,
		statusWord: state.statusWord,
		causeWord: state.causeWord,
		epcWord: state.epcWord,
		badAddressWord: state.badAddressWord,
		luaFaultReasonWord: state.luaFaultReasonWord,
		nmiReturnCauseWord: state.nmiReturnCauseWord,
		nmiReturnEpcWord: state.nmiReturnEpcWord,
		nmiReturnBadAddressWord: state.nmiReturnBadAddressWord,
		nmiReturnLuaFaultReasonWord: state.nmiReturnLuaFaultReasonWord,
		nonMaskableInterruptPending: state.nonMaskableInterruptPending,
		yieldRequested: state.yieldRequested,
	};
}

function decodeCpuRuntimeState(value: unknown, label: string): CpuRuntimeState {
	const object = requireObject(value, label);
	const executionCartridgeSlot = requireNumberValue(
		requireObjectKey(object, 'executionCartridgeSlot', label, 'cpuState.executionCartridgeSlot'),
		'cpuState.executionCartridgeSlot',
	);
	if (executionCartridgeSlot !== -1
		&& executionCartridgeSlot !== 0
		&& executionCartridgeSlot !== 1) {
		throw new Error('cpuState.executionCartridgeSlot must identify the system or a cartridge slot.');
	}
	return {
		executionCartridgeSlot,
		systemGlobals: decodeVector(
			requireObjectKey(object, 'systemGlobals', label, 'cpuState.systemGlobals'),
			'cpuState.systemGlobals',
			(entry) => decodeCpuRootValueState(entry, 'cpuState.systemGlobals[]'),
		),
		globals: decodeVector(
			requireObjectKey(object, 'globals', label, 'cpuState.globals'),
			'cpuState.globals',
			(entry) => decodeCpuRootValueState(entry, 'cpuState.globals[]'),
		),
		frames: decodeVector(
			requireObjectKey(object, 'frames', label, 'cpuState.frames'),
			'cpuState.frames',
			(entry) => decodeCpuFrameState(entry, 'cpuState.frames[]'),
		),
		protectedCalls: decodeVector(
			requireObjectKey(object, 'protectedCalls', label, 'cpuState.protectedCalls'),
			'cpuState.protectedCalls',
			(entry) => decodeCpuProtectedCallState(entry, 'cpuState.protectedCalls[]'),
		),
		completionValues: decodeVector(
			requireObjectKey(object, 'completionValues', label, 'cpuState.completionValues'),
			'cpuState.completionValues',
			(entry) => decodeCpuValueState(entry, 'cpuState.completionValues[]'),
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
		lastExecutionDomainId: requireObjectKey(
			object,
			'lastExecutionDomainId',
			label,
			'cpuState.lastExecutionDomainId',
		) as ExecutionDomainId,
		lastPc: requireObjectKey(object, 'lastPc', label, 'cpuState.lastPc') as number,
		instructionBudgetRemaining: requireObjectKey(object, 'instructionBudgetRemaining', label, 'cpuState.instructionBudgetRemaining') as number,
		haltedUntilIrq: requireObjectKey(object, 'haltedUntilIrq', label, 'cpuState.haltedUntilIrq') as boolean,
		interruptEventPending: requireObjectKey(object, 'interruptEventPending', label, 'cpuState.interruptEventPending') as boolean,
		memoryWriteBlocked: requireObjectKey(object, 'memoryWriteBlocked', label, 'cpuState.memoryWriteBlocked') as boolean,
		memoryWriteBlockedAddress: requireObjectKey(object, 'memoryWriteBlockedAddress', label, 'cpuState.memoryWriteBlockedAddress') as number,
		statusWord: requireObjectKey(object, 'statusWord', label, 'cpuState.statusWord') as number,
		causeWord: requireObjectKey(object, 'causeWord', label, 'cpuState.causeWord') as number,
		epcWord: requireObjectKey(object, 'epcWord', label, 'cpuState.epcWord') as number,
		badAddressWord: requireObjectKey(object, 'badAddressWord', label, 'cpuState.badAddressWord') as number,
		luaFaultReasonWord: requireObjectKey(object, 'luaFaultReasonWord', label, 'cpuState.luaFaultReasonWord') as number,
		nmiReturnCauseWord: requireObjectKey(object, 'nmiReturnCauseWord', label, 'cpuState.nmiReturnCauseWord') as number,
		nmiReturnEpcWord: requireObjectKey(object, 'nmiReturnEpcWord', label, 'cpuState.nmiReturnEpcWord') as number,
		nmiReturnBadAddressWord: requireObjectKey(object, 'nmiReturnBadAddressWord', label, 'cpuState.nmiReturnBadAddressWord') as number,
		nmiReturnLuaFaultReasonWord: requireObjectKey(object, 'nmiReturnLuaFaultReasonWord', label, 'cpuState.nmiReturnLuaFaultReasonWord') as number,
		nonMaskableInterruptPending: requireObjectKey(object, 'nonMaskableInterruptPending', label, 'cpuState.nonMaskableInterruptPending') as boolean,
		yieldRequested: requireObjectKey(object, 'yieldRequested', label, 'cpuState.yieldRequested') as boolean,
	};
}

function encodeRuntimeSaveStateValue(state: RuntimeSaveState): RuntimeSaveState {
	return {
		machineState: encodeRuntimeSaveMachineState(state.machineState),
		cpuState: encodeCpuRuntimeState(state.cpuState),
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
		luaInitialized: requireObjectKey(object, 'luaInitialized', label, 'runtimeSaveState.luaInitialized') as boolean,
		luaRuntimeFailed: requireObjectKey(object, 'luaRuntimeFailed', label, 'runtimeSaveState.luaRuntimeFailed') as boolean,
		pendingEntryCall: requireObjectKey(object, 'pendingEntryCall', label, 'runtimeSaveState.pendingEntryCall') as boolean,
	};
}

export function encodeRuntimeSaveState(state: RuntimeSaveState): Uint8Array {
	const bytes = encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
	let cartridgeRamByteCount = 0;
	for (let slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; slotIndex += 1) {
		cartridgeRamByteCount += state.machineState.machine.cartridge.slots[slotIndex].ram.byteLength;
	}
	if (bytes.byteLength > runtimeSaveStateWireCapacity(cartridgeRamByteCount)) {
		throw new Error('Runtime save-state payload exceeds the current-format wire capacity.');
	}
	return bytes;
}

export function decodeRuntimeSaveState(bytes: Uint8Array, cartridgeRamByteCount: number): RuntimeSaveState {
	if (bytes.byteLength > runtimeSaveStateWireCapacity(cartridgeRamByteCount)) {
		throw new Error('Runtime save-state payload exceeds the current-format wire capacity.');
	}
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(bytes, RUNTIME_SAVE_STATE_PROP_NAMES),
		'runtimeSaveState',
	);
}

export function captureRuntimeSaveStateBytes(runtime: Runtime): Uint8Array {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

export function applyRuntimeSaveStateBytes(runtime: Runtime, bytes: Uint8Array): void {
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(bytes, runtime.machine.cartridgeController.ramByteCount()),
	);
}
