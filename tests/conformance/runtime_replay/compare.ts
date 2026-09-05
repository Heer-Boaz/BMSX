import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { decodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';

const [tsPrefix, cppPrefix] = process.argv.slice(2);
for (const checkpointTick of [2, 400, 1200]) {
	const ts = decodeRuntimeSaveState(
		readFileSync(`${tsPrefix}-${checkpointTick}.state`),
		PSX_MACHINE_SPEC.ramBytes,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	const cpp = decodeRuntimeSaveState(
		readFileSync(`${cppPrefix}-${checkpointTick}.state`),
		PSX_MACHINE_SPEC.ramBytes,
		PSX_MACHINE_SPEC.gxGpuVramBytes,
	);
	// Avoid formatting megabytes of GPU/CPU state into an assertion diff.
	assert.ok(isDeepStrictEqual(ts, cpp), `TS/C++ full state at tick ${checkpointTick + 120}`);
	if (checkpointTick === 1200) {
		assert.equal(ts.cpuState.executionCartridgeSlot, 0, 'the real game must be executing');
		assert.ok(ts.machineState.machine.gxGpu.vramBytes.some(byte => byte !== 0), 'game VRAM must contain pixels');
		assert.ok(ts.machineState.machine.audio.output.voices.some(voice => voice.badp.nextFrame > 0), 'BADP playback must be active');
	}
}
console.log('RUNTIME-REPLAY-CROSS-CORE:PASS');
