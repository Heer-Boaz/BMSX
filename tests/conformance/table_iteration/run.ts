import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { valueBool } from '../../../machine/ts/machine/cpu/value';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileTableIterationTest, tableIterationVectors } from '../../helpers/table_iteration';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// The ordinary ROM path in this existing runner executes bounded CPU grants,
// snapshots every grant, and writes the complete final runtime state.
const nativeRunner = nativeConformanceRunner('bmsx_coroutine_runner', { configure: ['-DCMAKE_BUILD_TYPE=Release'] });

const directory = mkdtempSync(join(tmpdir(), 'bmsx-table-iteration-'));
try {
	for (const optLevel of [0, 3] as const) for (const [name, body] of Object.entries(tableIterationVectors)) {
		const image = compileTableIterationTest(body, optLevel);
		const path = join(directory, `${name}-O${optLevel}.rom`);
		writeFileSync(path, image.romBytes);
		const runtime = new Runtime({ systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const cpu = runtime.machine.cpu;
		let result = RunResult.Yielded;
		for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant++) {
			result = cpu.runUntilDepth(0, 17);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `${name}: guest assertion failed`);
			const snapshot = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(snapshot);
			assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		}
		assert.equal(result, RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
		assert.equal(spawnSync(nativeRunner, [path], { stdio: 'inherit' }).status, 0);
		const native = readFileSync(`${path}.state`);
		assert.equal(Buffer.compare(native, encodeRuntimeSaveState(captureRuntimeSaveState(runtime))), 0, `${name} O${optLevel}: complete TS/C++ table state parity`);
	}
	rmSync(directory, { recursive: true });
	console.log('TABLE-ITERATION-PARITY:PASS (deletion, collection, physical continuations and churn)');
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
