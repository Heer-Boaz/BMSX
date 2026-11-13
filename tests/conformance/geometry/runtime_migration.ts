import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { GeometryOverlap2dPhase } from '../../../machine/ts/machine/devices/geometry/overlap2d';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_BOOT_PRIMITIVES } from '../../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_GEO_DST0, IO_GEO_DST1, IO_GEO_FAULT, IO_GEO_PROCESSED, IO_GEO_STATUS, IO_IRQ_FLAGS, IRQ_GEO_DONE } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_SUMMARY_BYTES, GEO_STATUS_DONE } from '../../../machine/ts/machine/devices/geometry/contracts';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { geometryVectors } from './vectors';

const code = new Uint8Array(2 * INSTRUCTION_BYTES);
writeInstruction(code, 0, OpCode.HALT, 0, 0, 0, 0);
writeInstruction(code, 1, OpCode.HALT, 0, 0, 0, 0);
const system = linkRawTestSystemBlua32({
	text: code,
	functions: [{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 1 }],
	systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name),
	startupFunctionIndex: 0,
	irqFunctionIndex: 1,
	exceptionFunctionIndex: 1,
});

function createRuntime(): Runtime {
	const runtime = new Runtime({
		systemRomBytes: system.romBytes,
		cartridgeSlots: cartridgeSlots(),
		machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter,
	}, {
		sampleInputControllerSnapshot() {},
		supervisorRequestLineHigh() { return false; },
		applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	return runtime;
}

function trace(runtime: Runtime): string {
	const machine = runtime.machine;
	const state = machine.geometryController.captureState();
	const memory = machine.memory;
	const words = [machine.scheduler.nowCycles, state.pendingCycles, state.overlap.phase,
		memory.readMappedWord(IO_GEO_STATUS), memory.readMappedWord(IO_GEO_PROCESSED),
		memory.readMappedWord(IO_GEO_FAULT), memory.readMappedWord(IO_IRQ_FLAGS)];
	const dst0 = memory.readMappedWord(IO_GEO_DST0);
	const dst1 = memory.readMappedWord(IO_GEO_DST1);
	for (let i = 0; i < GEO_OVERLAP2D_RESULT_BYTES / IO_WORD_SIZE; ++i) words.push(memory.readU32(dst0 + i * IO_WORD_SIZE));
	for (let i = 0; i < GEO_OVERLAP2D_SUMMARY_BYTES / IO_WORD_SIZE; ++i) words.push(memory.readU32(dst1 + i * IO_WORD_SIZE));
	return words.join(' ');
}

function resume(bytes: Uint8Array): string {
	const runtime = createRuntime();
	const state = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	applyRuntimeSaveState(runtime, state);
	const geo = runtime.machine.geometryController;
	const lines = [trace(runtime)];
	while (geo.hasPendingWork()) {
		const pending = geo.captureState().pendingCycles;
		if (pending > 1) {
			advanceRuntimeTime(runtime, pending - 1);
			lines.push(trace(runtime));
		}
		if (pending > 0) advanceRuntimeTime(runtime, 1);
		else runDueRuntimeTimers(runtime);
		lines.push(trace(runtime));
	}
	return lines.join('\n');
}

const command = process.argv.slice(2);
if (command.length === 0) {
	for (const args of [
		['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-DBMSX_BUILD_TESTS=ON', '-DCMAKE_BUILD_TYPE=Release'],
		['--build', 'build-cpp-tests', '--target', 'bmsx_geometry_runtime_migration_runner', '--parallel', '2'],
	]) assert.equal(spawnSync('cmake', args, { stdio: 'inherit' }).status, 0);
	command.push(resolve('build-cpp-tests/bmsx_geometry_runtime_migration_runner'));
}

const directory = mkdtempSync(join(tmpdir(), 'bmsx-geo-migration-'));
try {
	const biosPath = join(directory, 'bios.rom');
	const vectorPath = join(directory, 'geometry.txt');
	const cppPrefix = join(directory, 'cpp');
	const tsPrefix = join(directory, 'ts');
	const runner = command[0]!;
	const vector = geometryVectors().find(entry => entry.name === 'overlap-overlap')!;
	writeFileSync(biosPath, system.romBytes);
	writeFileSync(vectorPath, vector.writes.map(([address, word]) => `${address >>> 0} ${word >>> 0}`).join('\n'));
	const generated = spawnSync(runner, [...command.slice(1), 'export', biosPath, vectorPath, cppPrefix], { encoding: 'utf8' });
	assert.equal(generated.status, 0, generated.stderr);
	const runtime = createRuntime();
	for (const [address, word] of vector.writes) runtime.machine.memory.writeMappedWord(address, word);
	runDueRuntimeTimers(runtime);
	const geo = runtime.machine.geometryController;
	assert.equal(geo.captureState().pendingCycles, 4);
	advanceRuntimeTime(runtime, 3);
	assert.equal(geo.captureState().pendingCycles, 1);
	writeFileSync(`${tsPrefix}-init.state`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	advanceRuntimeTime(runtime, 1);
	assert.equal(geo.captureState().pendingCycles, 26);
	advanceRuntimeTime(runtime, 26);
	assert.equal(geo.captureState().overlap.phase, GeometryOverlap2dPhase.CompletePiece);
	assert.ok(geo.captureState().pendingCycles > 0);
	writeFileSync(`${tsPrefix}-piece.state`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	advanceRuntimeTime(runtime, geo.captureState().pendingCycles);
	assert.equal(geo.captureState().overlap.phase, GeometryOverlap2dPhase.Publish);
	assert.equal(geo.captureState().pendingCycles, 13);
	writeFileSync(`${tsPrefix}-publish.state`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	for (const phase of ['init', 'piece', 'publish']) {
		const tsState = `${tsPrefix}-${phase}.state`;
		const cppState = `${cppPrefix}-${phase}.state`;
		const fromTs = spawnSync(runner, [...command.slice(1), 'resume', biosPath, tsState], { encoding: 'utf8' });
		const fromCpp = spawnSync(runner, [...command.slice(1), 'resume', biosPath, cppState], { encoding: 'utf8' });
		assert.equal(fromTs.status, 0, fromTs.stderr);
		assert.equal(fromCpp.status, 0, fromCpp.stderr);
		const tsFromTs = resume(readFileSync(tsState));
		const tsFromCpp = resume(readFileSync(cppState));
		assert.equal(fromTs.stdout.trim(), tsFromTs, `C++ resumes TS ${phase} state at identical edges`);
		assert.equal(tsFromCpp, fromCpp.stdout.trim(), `TS resumes C++ ${phase} state at identical edges`);
		assert.equal(tsFromCpp, tsFromTs, `${phase} snapshot progress and visible output are equivalent`);
		const final = tsFromTs.split('\n').at(-1)!.split(' ').map(Number);
		assert.equal(final[3], GEO_STATUS_DONE, `${phase}: job completed successfully`);
		assert.equal(final[4], 2, `${phase}: both full-pass outer records completed`);
		assert.equal(final[5], 0, `${phase}: no geometry fault`);
		assert.equal(final[6] & IRQ_GEO_DONE, IRQ_GEO_DONE, `${phase}: completion IRQ is visible`);
		assert.deepEqual(final.slice(7, 16), [0, 0xbf800000, 0x40400000, 0x40200000, 0x40200000, 0, 0, 0, 1], `${phase}: exact contact oracle`);
		assert.deepEqual(final.slice(16), [1, 1, 1, 0], `${phase}: exact result/exact-pair/broadphase summary`);
		console.log(`GEO-ACTIVE-CROSS-CORE:${phase}:PASS`);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
