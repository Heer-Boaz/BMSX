import { decodeBinaryWithPropTable, encodeBinaryWithPropTable, requireObject, VERSION as BINENC_VERSION } from '../../../common/serializer/binencoder';
import { RuntimeSaveState } from '../contracts';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../save_state';
import { RUNTIME_SAVE_STATE_PROP_NAMES, RUNTIME_SAVE_STATE_WIRE_VERSION } from './schema';
import type { Runtime } from '../runtime';

const RUNTIME_SAVE_STATE_FRAME_BYTES = 2;

export function encodeRuntimeSaveState(state: RuntimeSaveState): Uint8Array {
	const payload = encodeBinaryWithPropTable(state, RUNTIME_SAVE_STATE_PROP_NAMES);
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
	return requireObject(
		decodeBinaryWithPropTable(bytes.subarray(RUNTIME_SAVE_STATE_FRAME_BYTES), RUNTIME_SAVE_STATE_PROP_NAMES),
		'runtimeSaveState',
	) as RuntimeSaveState;
}

export function captureRuntimeSaveStateBytes(runtime: Runtime): Uint8Array {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

export function applyRuntimeSaveStateBytes(runtime: Runtime, bytes: Uint8Array): void {
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes));
}
