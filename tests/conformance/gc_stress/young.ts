import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileCoroutineTest } from '../../helpers/coroutine';
import { exerciseYoungGc, gcYoungBody } from '../../helpers/gc_young';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const buildDirectory = process.argv[2] ?? 'build-native-cpu-default';
const nativeRunner = nativeConformanceRunner('bmsx_gc_stress_runner', {
	buildDirectory,
	configure: ['-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
	parallel: '2',
});

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-young-'));
try {
	const image = compileCoroutineTest(gcYoungBody, 3), path = join(directory, 'young-O3.rom');
	writeFileSync(path, image.romBytes);
	for (const compiled of [false, true]) {
		const runtime = new Runtime({
			systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter,
		}, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false,
			applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot(); exerciseYoungGc(runtime.machine.cpu, compiled);
		const expected = decodeRuntimeSaveState(encodeRuntimeSaveState(captureRuntimeSaveState(runtime)),
			PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.equal(spawnSync(nativeRunner, [path, compiled ? 'native' : 'scalar', 'young'], { stdio: 'inherit' }).status, 0);
		const actual = decodeRuntimeSaveState(new Uint8Array(readFileSync(`${path}.state`)), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
		assert.deepEqual(actual, expected, `young O3, compiled=${compiled}: complete TS/C++ runtime-state parity`);
	}
	console.log('YOUNG-GC-PARITY:PASS (O3 scalar/generated, automatic minors and exact checkpoint replay)');
} finally {
	rmSync(directory, { recursive: true, force: true });
}
