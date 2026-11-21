import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileCoroutineTest } from '../../helpers/coroutine';
import { exerciseGcPressure, gcPressureBody } from '../../helpers/gc_pressure';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const buildDirectory = process.argv[2] ?? 'build-native-cpu-default';
const nativeRunner = nativeConformanceRunner('bmsx_gc_stress_runner', {
	buildDirectory,
	configure: ['-DBMSX_ENABLE_NATIVE_BLOCKS=ON'],
	parallel: '2',
});

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-pressure-'));
try {
	const image = compileCoroutineTest(gcPressureBody, 3), path = join(directory, 'pressure-O3.rom');
	writeFileSync(path, image.romBytes);
	for (const compiled of [false, true]) {
		const runtime = new Runtime({
			systemRomBytes: image.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
			cpuExecutionBackend: compiled ? CpuExecutionBackend.JavaScript : CpuExecutionBackend.Interpreter,
		}, {
			sampleInputControllerSnapshot: () => {}, supervisorRequestLineHigh: () => false,
			applyInputControllerVibrationEffect: () => {},
		});
		runtime.boot(); exerciseGcPressure(runtime.machine.cpu, compiled);
		assert.equal(spawnSync(nativeRunner, [path, compiled ? 'native' : 'scalar', 'pressure'], { stdio: 'inherit' }).status, 0);
	}
	console.log('GC-PRESSURE-PARITY:PASS (O3 scalar/generated, paced collection and observed checkpoint replay)');
} finally {
	rmSync(directory, { recursive: true, force: true });
}
