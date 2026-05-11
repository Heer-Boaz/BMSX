import { decodeBinaryWithPropTable, encodeBinaryWithPropTable, requireObject, requireObjectKey, VERSION as BINENC_VERSION } from '../../../common/serializer/binencoder';
import type { MachineSaveState } from '../../machine';
import type { CpuFrameState, CpuObjectState, CpuRootValueState, CpuRuntimeRefSegment, CpuRuntimeState, CpuValueState } from '../../cpu/cpu';
import type { IrqControllerState } from '../../devices/irq/controller';
import type { StringPoolState, StringPoolStateEntry } from '../../cpu/string_pool';
import type { InputControllerState } from '../../devices/input/controller';
import type { VdpSaveState, VdpState, VdpSurfacePixelsState } from '../../devices/vdp/vdp';
import { VDP_XF_MATRIX_COUNT, VDP_XF_MATRIX_REGISTER_WORDS } from '../../devices/vdp/xf';
import type { MemorySaveState } from '../../memory/memory';
import type { FrameSchedulerStateSnapshot, TickCompletion } from '../../scheduler/frame';
import type {
	RuntimeAmbientLightState,
	RuntimeDirectionalLightState,
	RuntimePointLightState,
	RuntimeRenderCameraState,
	RuntimeRenderState,
	RuntimeSaveMachineState,
	RuntimeSaveState,
} from '../contracts';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../save_state';
import { RUNTIME_SAVE_STATE_PROP_NAMES, RUNTIME_SAVE_STATE_WIRE_VERSION } from './schema';
import type { Runtime } from '../runtime';

const RUNTIME_SAVE_STATE_FRAME_BYTES = 2;

type CpuTableHashNodeState = Extract<CpuObjectState, { kind: 'table' }>['hash'][number];
type CameraWireState = {
	view: number[];
	proj: number[];
	eye: [number, number, number];
};

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

function requireBoundedU32(value: unknown, label: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${label} must be a u32 value between ${min} and ${max}.`);
	}
	return value >>> 0;
}

function encodeCameraState(state: CameraWireState): CameraWireState {
	return {
		view: state.view,
		proj: state.proj,
		eye: state.eye,
	};
}

function decodeCameraState(value: unknown, label: string): CameraWireState {
	const object = requireObject(value, label);
	return {
		view: requireObjectKey(object, 'view', label, `${label}.view`) as number[],
		proj: requireObjectKey(object, 'proj', label, `${label}.proj`) as number[],
		eye: requireObjectKey(object, 'eye', label, `${label}.eye`) as [number, number, number],
	};
}

function encodeRuntimeAmbientLightState(state: RuntimeAmbientLightState): RuntimeAmbientLightState {
	return {
		id: state.id,
		color: state.color,
		intensity: state.intensity,
	};
}

function decodeRuntimeAmbientLightState(value: unknown, label: string): RuntimeAmbientLightState {
	const object = requireObject(value, label);
	return {
		id: requireObjectKey(object, 'id', label, 'renderState.ambientLights[].id') as string,
		color: requireObjectKey(object, 'color', label, 'renderState.ambientLights[].color') as [number, number, number],
		intensity: requireObjectKey(object, 'intensity', label, 'renderState.ambientLights[].intensity') as number,
	};
}

function encodeRuntimeDirectionalLightState(state: RuntimeDirectionalLightState): RuntimeDirectionalLightState {
	return {
		id: state.id,
		color: state.color,
		intensity: state.intensity,
		orientation: state.orientation,
	};
}

function decodeRuntimeDirectionalLightState(value: unknown, label: string): RuntimeDirectionalLightState {
	const object = requireObject(value, label);
	return {
		id: requireObjectKey(object, 'id', label, 'renderState.directionalLights[].id') as string,
		color: requireObjectKey(object, 'color', label, 'renderState.directionalLights[].color') as [number, number, number],
		intensity: requireObjectKey(object, 'intensity', label, 'renderState.directionalLights[].intensity') as number,
		orientation: requireObjectKey(object, 'orientation', label, 'renderState.directionalLights[].orientation') as [number, number, number],
	};
}

function encodeRuntimePointLightState(state: RuntimePointLightState): RuntimePointLightState {
	return {
		id: state.id,
		color: state.color,
		intensity: state.intensity,
		pos: state.pos,
		range: state.range,
	};
}

function decodeRuntimePointLightState(value: unknown, label: string): RuntimePointLightState {
	const object = requireObject(value, label);
	return {
		id: requireObjectKey(object, 'id', label, 'renderState.pointLights[].id') as string,
		color: requireObjectKey(object, 'color', label, 'renderState.pointLights[].color') as [number, number, number],
		intensity: requireObjectKey(object, 'intensity', label, 'renderState.pointLights[].intensity') as number,
		pos: requireObjectKey(object, 'pos', label, 'renderState.pointLights[].pos') as [number, number, number],
		range: requireObjectKey(object, 'range', label, 'renderState.pointLights[].range') as number,
	};
}

function encodeRuntimeRenderState(state: RuntimeRenderState): RuntimeRenderState {
	return {
		camera: state.camera === null ? null : encodeCameraState(state.camera),
		ambientLights: encodeVector(state.ambientLights, encodeRuntimeAmbientLightState),
		directionalLights: encodeVector(state.directionalLights, encodeRuntimeDirectionalLightState),
		pointLights: encodeVector(state.pointLights, encodeRuntimePointLightState),
	};
}

function decodeRuntimeRenderState(value: unknown, label: string): RuntimeRenderState {
	const object = requireObject(value, label);
	const camera = requireObjectKey(object, 'camera', label, 'renderState.camera');
	return {
		camera: camera === null ? null : decodeCameraState(camera, 'renderState.camera') as RuntimeRenderCameraState,
		ambientLights: decodeVector(
			requireObjectKey(object, 'ambientLights', label, 'renderState.ambientLights'),
			'renderState.ambientLights',
			(entry) => decodeRuntimeAmbientLightState(entry, 'renderState.ambientLights[]'),
		),
		directionalLights: decodeVector(
			requireObjectKey(object, 'directionalLights', label, 'renderState.directionalLights'),
			'renderState.directionalLights',
			(entry) => decodeRuntimeDirectionalLightState(entry, 'renderState.directionalLights[]'),
		),
		pointLights: decodeVector(
			requireObjectKey(object, 'pointLights', label, 'renderState.pointLights'),
			'renderState.pointLights',
			(entry) => decodeRuntimePointLightState(entry, 'renderState.pointLights[]'),
		),
	};
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
		cyclesIntoFrame: state.cyclesIntoFrame,
	};
}

function decodeRuntimeVblankState(value: unknown, label: string): RuntimeSaveMachineState['vblank'] {
	const object = requireObject(value, label);
	return {
		cyclesIntoFrame: requireObjectKey(object, 'cyclesIntoFrame', label, 'vblank.cyclesIntoFrame') as number,
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
		ram: requireObjectKey(object, 'ram', label, 'machine.memory.ram') as Uint8Array,
		busFaultCode: requireObjectKey(object, 'busFaultCode', label, 'machine.memory.busFaultCode') as number,
		busFaultAddr: requireObjectKey(object, 'busFaultAddr', label, 'machine.memory.busFaultAddr') as number,
		busFaultAccess: requireObjectKey(object, 'busFaultAccess', label, 'machine.memory.busFaultAccess') as number,
	};
}

function encodeIrqControllerState(state: IrqControllerState): IrqControllerState {
	return {
		pendingFlags: state.pendingFlags >>> 0,
	};
}

function decodeIrqControllerState(value: unknown, label: string): IrqControllerState {
	const object = requireObject(value, label);
	return {
		pendingFlags: requireObjectKey(object, 'pendingFlags', label, 'machine.irq.pendingFlags') as number,
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
	};
}

function decodeInputControllerState(value: unknown, label: string): InputControllerState {
	const object = requireObject(value, label);
	return {
		sampleArmed: requireObjectKey(object, 'sampleArmed', label, 'machine.input.sampleArmed') as boolean,
	};
}

function encodeVdpState(state: VdpState): VdpState {
	return {
		xf: {
			matrixWords: state.xf.matrixWords,
			viewMatrixIndex: state.xf.viewMatrixIndex,
			projectionMatrixIndex: state.xf.projectionMatrixIndex,
		},
		skyboxControl: state.skyboxControl,
		skyboxFaceWords: state.skyboxFaceWords,
		pmuSelectedBank: state.pmuSelectedBank,
		pmuBankWords: state.pmuBankWords,
		ditherType: state.ditherType,
		vdpFaultCode: state.vdpFaultCode,
		vdpFaultDetail: state.vdpFaultDetail,
	};
}

function decodeVdpState(value: unknown, label: string): VdpState {
	const object = requireObject(value, label);
	const xf = requireObject(requireObjectKey(object, 'xf', label, 'machine.vdp.xf'), 'machine.vdp.xf');
	return {
		xf: {
			matrixWords: decodeU32FixedArray(requireObjectKey(xf, 'matrixWords', 'machine.vdp.xf', 'machine.vdp.xf.matrixWords'), 'machine.vdp.xf.matrixWords', VDP_XF_MATRIX_REGISTER_WORDS),
			viewMatrixIndex: requireBoundedU32(requireObjectKey(xf, 'viewMatrixIndex', 'machine.vdp.xf', 'machine.vdp.xf.viewMatrixIndex'), 'machine.vdp.xf.viewMatrixIndex', 0, VDP_XF_MATRIX_COUNT - 1),
			projectionMatrixIndex: requireBoundedU32(requireObjectKey(xf, 'projectionMatrixIndex', 'machine.vdp.xf', 'machine.vdp.xf.projectionMatrixIndex'), 'machine.vdp.xf.projectionMatrixIndex', 0, VDP_XF_MATRIX_COUNT - 1),
		},
		skyboxControl: requireObjectKey(object, 'skyboxControl', label, 'machine.vdp.skyboxControl') as number,
		skyboxFaceWords: requireObjectKey(object, 'skyboxFaceWords', label, 'machine.vdp.skyboxFaceWords') as number[],
		pmuSelectedBank: requireObjectKey(object, 'pmuSelectedBank', label, 'machine.vdp.pmuSelectedBank') as number,
		pmuBankWords: requireObjectKey(object, 'pmuBankWords', label, 'machine.vdp.pmuBankWords') as number[],
		ditherType: requireObjectKey(object, 'ditherType', label, 'machine.vdp.ditherType') as number,
		vdpFaultCode: requireObjectKey(object, 'vdpFaultCode', label, 'machine.vdp.vdpFaultCode') as number,
		vdpFaultDetail: requireObjectKey(object, 'vdpFaultDetail', label, 'machine.vdp.vdpFaultDetail') as number,
	};
}

function encodeVdpSurfacePixelsState(state: VdpSurfacePixelsState): VdpSurfacePixelsState {
	return {
		surfaceId: state.surfaceId,
		pixels: state.pixels,
	};
}

function decodeVdpSurfacePixelsState(value: unknown, label: string): VdpSurfacePixelsState {
	const object = requireObject(value, label);
	return {
		surfaceId: requireObjectKey(object, 'surfaceId', label, 'machine.vdp.surfacePixels.surfaceId') as number,
		pixels: requireObjectKey(object, 'pixels', label, 'machine.vdp.surfacePixels.pixels') as Uint8Array,
	};
}

function encodeVdpSaveState(state: VdpSaveState): VdpSaveState {
	return {
		...encodeVdpState(state),
		vramStaging: state.vramStaging,
		surfacePixels: encodeVector(state.surfacePixels, encodeVdpSurfacePixelsState),
		displayFrameBufferPixels: state.displayFrameBufferPixels,
	};
}

function decodeVdpSaveState(value: unknown, label: string): VdpSaveState {
	const object = requireObject(value, label);
	return {
		...decodeVdpState(value, label),
		vramStaging: requireObjectKey(object, 'vramStaging', label, 'machine.vdp.vramStaging') as Uint8Array,
		surfacePixels: decodeVector(
			requireObjectKey(object, 'surfacePixels', label, 'machine.vdp.surfacePixels'),
			'machine.vdp.surfacePixels',
			(entry) => decodeVdpSurfacePixelsState(entry, 'machine.vdp.surfacePixels[]'),
		),
		displayFrameBufferPixels: requireObjectKey(object, 'displayFrameBufferPixels', label, 'machine.vdp.displayFrameBufferPixels') as Uint8Array,
	};
}

function encodeMachineSaveState(state: MachineSaveState): MachineSaveState {
	return {
		memory: encodeMemorySaveState(state.memory),
		irq: encodeIrqControllerState(state.irq),
		stringPool: encodeStringPoolState(state.stringPool),
		input: encodeInputControllerState(state.input),
		vdp: encodeVdpSaveState(state.vdp),
	};
}

function decodeMachineSaveState(value: unknown, label: string): MachineSaveState {
	const object = requireObject(value, label);
	return {
		memory: decodeMemorySaveState(requireObjectKey(object, 'memory', label, 'machineState.machine.memory'), 'machineState.machine.memory'),
		irq: decodeIrqControllerState(requireObjectKey(object, 'irq', label, 'machineState.machine.irq'), 'machineState.machine.irq'),
		stringPool: decodeStringPoolState(requireObjectKey(object, 'stringPool', label, 'machineState.machine.stringPool'), 'machineState.machine.stringPool'),
		input: decodeInputControllerState(requireObjectKey(object, 'input', label, 'machineState.machine.input'), 'machineState.machine.input'),
		vdp: decodeVdpSaveState(requireObjectKey(object, 'vdp', label, 'machineState.machine.vdp'), 'machineState.machine.vdp'),
	};
}

function encodeRuntimeSaveMachineState(state: RuntimeSaveMachineState): RuntimeSaveMachineState {
	return {
		machine: encodeMachineSaveState(state.machine),
		frameScheduler: encodeFrameSchedulerState(state.frameScheduler),
		vblank: encodeRuntimeVblankState(state.vblank),
	};
}

function decodeRuntimeSaveMachineState(value: unknown, label: string): RuntimeSaveMachineState {
	const object = requireObject(value, label);
	return {
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
		renderState: encodeRuntimeRenderState(state.renderState),
		systemProgramActive: state.systemProgramActive,
		luaInitialized: state.luaInitialized,
		luaRuntimeFailed: state.luaRuntimeFailed,
		randomSeed: state.randomSeed,
		pendingEntryCall: state.pendingEntryCall,
	};
}

function decodeRuntimeSaveStateValue(value: unknown, label: string): RuntimeSaveState {
	const object = requireObject(value, label);
	return {
		machineState: decodeRuntimeSaveMachineState(requireObjectKey(object, 'machineState', label, 'runtimeSaveState.machineState'), 'runtimeSaveState.machineState'),
		cpuState: decodeCpuRuntimeState(requireObjectKey(object, 'cpuState', label, 'runtimeSaveState.cpuState'), 'runtimeSaveState.cpuState'),
		renderState: decodeRuntimeRenderState(requireObjectKey(object, 'renderState', label, 'runtimeSaveState.renderState'), 'runtimeSaveState.renderState'),
		systemProgramActive: requireObjectKey(object, 'systemProgramActive', label, 'runtimeSaveState.systemProgramActive') as boolean,
		luaInitialized: requireObjectKey(object, 'luaInitialized', label, 'runtimeSaveState.luaInitialized') as boolean,
		luaRuntimeFailed: requireObjectKey(object, 'luaRuntimeFailed', label, 'runtimeSaveState.luaRuntimeFailed') as boolean,
		randomSeed: requireObjectKey(object, 'randomSeed', label, 'runtimeSaveState.randomSeed') as number,
		pendingEntryCall: requireObjectKey(object, 'pendingEntryCall', label, 'runtimeSaveState.pendingEntryCall') as boolean,
	};
}

export function encodeRuntimeSaveState(state: RuntimeSaveState): Uint8Array {
	const payload = encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
	const bytes = new Uint8Array(RUNTIME_SAVE_STATE_FRAME_BYTES + payload.length);
	bytes[0] = BINENC_VERSION;
	bytes[1] = RUNTIME_SAVE_STATE_WIRE_VERSION;
	bytes.set(payload, RUNTIME_SAVE_STATE_FRAME_BYTES);
	return bytes;
}

export function decodeRuntimeSaveState(bytes: Uint8Array): RuntimeSaveState {
	if (bytes.length < RUNTIME_SAVE_STATE_FRAME_BYTES) {
		throw new Error('runtimeSaveState payload is truncated.');
	}
	if (bytes[0] !== BINENC_VERSION) {
		throw new Error(`runtimeSaveState binenc version must be ${BINENC_VERSION}.`);
	}
	if (bytes[1] !== RUNTIME_SAVE_STATE_WIRE_VERSION) {
		throw new Error(`runtimeSaveState wire version must be ${RUNTIME_SAVE_STATE_WIRE_VERSION}.`);
	}
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(bytes.subarray(RUNTIME_SAVE_STATE_FRAME_BYTES), RUNTIME_SAVE_STATE_PROP_NAMES),
		'runtimeSaveState',
	);
}

export function captureRuntimeSaveStateBytes(runtime: Runtime): Uint8Array {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

export function applyRuntimeSaveStateBytes(runtime: Runtime, bytes: Uint8Array): void {
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes));
}
