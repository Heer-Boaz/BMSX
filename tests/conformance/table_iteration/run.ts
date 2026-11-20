import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { valueNil, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileTableIterationTest, tableIterationVectors } from '../../helpers/table_iteration';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runSystemCaseRom, systemCaseSource } from '../../helpers/system_case_rom';

const nativeRunner = nativeConformanceRunner('bmsx_frame_evaluation_runner', { parallel: '2' });
const directory = mkdtempSync(join(tmpdir(), 'bmsx-table-iteration-'));
try {
	const cases = Object.entries(tableIterationVectors);
	const { romBytes } = compileTableIterationTest(systemCaseSource(cases), 3);
	const path = join(directory, 'table-iteration.rom');
	writeFileSync(path, romBytes);
	assert.equal(runSystemCaseRom(romBytes, runtime => {
		const cpu = runtime.machine.cpu;
		const bytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
		runtime.rebootSystem();
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.ok(cpu.isHaltedUntilIrq());
		const table = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('checkpoint_table')!));
		const key = cpu.getGlobalByKey(cpu.stringPool.find('checkpoint_key')!);
		assert.equal(cpu.gc.tables.get(table, key), valueNil(), 'restore must not revive a deleted mapping');
	}), 1, 'restore exactly one suspended iterator');
	assert.equal(execFileSync(nativeRunner, [path, 'table'], { encoding: 'utf8' }).trim(), '1');
	rmSync(directory, { recursive: true });
	console.log(`TABLE-ITERATION-PARITY:PASS (${cases.length} guest cases, including continuation after real restore)`);
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
