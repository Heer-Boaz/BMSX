import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { GeometryOverlap2dPhase } from '../../../machine/ts/machine/devices/geometry/overlap2d';
import { GeometrySat2Phase } from '../../../machine/ts/machine/devices/geometry/sat2';
import { GeometryXform2Phase } from '../../../machine/ts/machine/devices/geometry/xform2';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_BOOT_PRIMITIVES } from '../../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import * as io from '../../../machine/ts/spec/bmsx/io';
import { IO_GEO_DST0, IO_GEO_DST1, IO_GEO_FAULT, IO_GEO_PROCESSED, IO_GEO_STATUS, IO_IRQ_FLAGS, IRQ_GEO_DONE } from '../../../machine/ts/spec/bmsx/io';
import { DYNAMIC_RAM_BASE, IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { GEO_OVERLAP2D_RESULT_BYTES, GEO_OVERLAP2D_SUMMARY_BYTES, GEO_STATUS_DONE, IO_CMD_GEO_XFORM2_BATCH } from '../../../machine/ts/machine/devices/geometry/contracts';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { geometryVectors } from './vectors';

// RAM outside any test image's static storage, for GEO operands and results.
const GEO_BUFFERS = DYNAMIC_RAM_BASE + 0x10000;

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
	const words = [machine.scheduler.nowCycles, state.pendingCycles, state.overlap.phase, state.xform.phase, state.sat.phase,
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

	const scratch = GEO_BUFFERS;
	const xformWrites: [number, number][] = [];
	const words = (address: number, values: number[]) => values.forEach((value, i) => xformWrites.push([address + i * 4, value]));
	words(scratch, [0, 0, 0, 0, 2, 0]);
	words(scratch + 0x100, [0x10000, 0x20000, 0x50000, 0x60000, 0xdeadbeef, 0xdeadbeef]);
	words(scratch + 0x200, [0x10000, 0, 0x10000, 0, 0x10000, 0]);
	words(scratch + 0x300, [0, 0, 0, 0]);
	xformWrites.push(
		[io.IO_GEO_SRC0, scratch], [io.IO_GEO_SRC1, scratch + 0x100], [io.IO_GEO_SRC2, scratch + 0x200],
		[io.IO_GEO_DST0, scratch + 0x108], [io.IO_GEO_DST1, scratch + 0x300], [io.IO_GEO_COUNT, 1],
		[io.IO_GEO_STRIDE0, 24], [io.IO_GEO_STRIDE1, 8], [io.IO_GEO_STRIDE2, 24], [io.IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH],
	);
	const overlapWrites = geometryVectors().find(entry => entry.name === 'overlap-overlap')!.writes;
	const satWrites = geometryVectors().find(entry => entry.name === 'sat-overlap')!.writes.map(([address, value]): [number, number] =>
		[address, address === io.IO_GEO_DST1 ? scratch + 0x500 : value]);
	const scenarios = [
		{ name: 'overlap', writes: overlapWrites, stages: ['init', 'piece', 'publish'], processed: 2,
			result: [0, 0xbf800000, 0x40400000, 0x40200000, 0x40200000, 0, 0, 0, 1], summary: [1, 1, 1, 0] },
		{ name: 'sat', writes: satWrites, stages: ['load-a', 'load-b', 'publish'], processed: 1,
			result: [1, 0, 0x10000, 0x30000, 0, 0xdeadbeef, 0xdeadbeef, 0xdeadbeef, 0xdeadbeef], summary: [0, 0, 0, 0] },
		{ name: 'xform', writes: xformWrites, stages: ['publish'], processed: 1,
			result: [0x20000, 0x20000, 0x60000, 0x60000, 0, 0, 0, 0, 0], summary: [0x20000, 0x20000, 0x60000, 0x60000] },
	] as const;
	writeFileSync(biosPath, system.romBytes);
	for (const scenario of scenarios) {
		writeFileSync(vectorPath, scenario.writes.map(([address, word]) => `${address >>> 0} ${word >>> 0}`).join('\n'));
		const generated = spawnSync(runner, [...command.slice(1), 'export', biosPath, vectorPath, cppPrefix, scenario.name], { encoding: 'utf8' });
		assert.equal(generated.status, 0, generated.stderr);
		const runtime = createRuntime();
		if (scenario.name === 'sat') {
			const initial = runtime.machine.geometryController.captureState();
			initial.sat.verticesA[127] = 0xfedcba98;
			initial.sat.verticesB[126] = 0x89abcdef;
			runtime.machine.geometryController.restoreState(initial, runtime.machine.scheduler.nowCycles);
		} else if (scenario.name === 'xform') {
			const initial = runtime.machine.geometryController.captureState();
			initial.xform.vertices[127] = 0xfedcba98;
			runtime.machine.geometryController.restoreState(initial, runtime.machine.scheduler.nowCycles);
		}
		for (const [address, word] of scenario.writes) runtime.machine.memory.writeMappedWord(address, word);
		runDueRuntimeTimers(runtime);
		const geo = runtime.machine.geometryController;
		const save = (phase: string) => writeFileSync(`${tsPrefix}-${phase}.state`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const payAll = () => advanceRuntimeTime(runtime, geo.captureState().pendingCycles);
		const leaveOne = () => {
			const pending = geo.captureState().pendingCycles;
			assert.ok(pending > 0);
			if (pending > 1) advanceRuntimeTime(runtime, pending - 1);
			assert.equal(geo.captureState().pendingCycles, 1);
		};
		if (scenario.name === 'overlap') {
			assert.equal(geo.captureState().pendingCycles, 4);
			leaveOne(); save('init'); payAll();
			assert.equal(geo.captureState().pendingCycles, 26);
			payAll();
			assert.equal(geo.captureState().overlap.phase, GeometryOverlap2dPhase.CompletePiece);
			assert.ok(geo.captureState().pendingCycles > 0);
			save('piece'); payAll();
			assert.equal(geo.captureState().overlap.phase, GeometryOverlap2dPhase.Publish);
			assert.equal(geo.captureState().pendingCycles, 13);
			save('publish');
		} else if (scenario.name === 'sat') {
			assert.equal(geo.captureState().sat.phase, GeometrySat2Phase.LoadA);
			assert.equal(geo.captureState().pendingCycles, 13);
			payAll();
			assert.equal(geo.captureState().sat.phase, GeometrySat2Phase.LoadB);
			assert.equal(geo.captureState().pendingCycles, 8);
			leaveOne(); save('load-a'); payAll();
			assert.equal(geo.captureState().sat.phase, GeometrySat2Phase.Compute);
			assert.equal(geo.captureState().pendingCycles, 8);
			leaveOne(); save('load-b'); payAll();
			assert.equal(geo.captureState().sat.phase, GeometrySat2Phase.Publish);
			leaveOne(); save('publish');
		} else {
			assert.equal(geo.captureState().xform.phase, GeometryXform2Phase.Publish);
			assert.ok(geo.captureState().pendingCycles > 0);
			runtime.machine.memory.writeU32(scratch + 0x100, 0x90000);
			runtime.machine.memory.writeU32(scratch + 0x208, 0x70000);
			leaveOne(); save('publish');
		}
		for (const phase of scenario.stages) {
			const tsState = `${tsPrefix}-${phase}.state`;
			const cppState = `${cppPrefix}-${phase}.state`;
			const tsBytes = readFileSync(tsState), cppBytes = readFileSync(cppState);
			const tsGeometry = decodeRuntimeSaveState(tsBytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes).machineState.machine.geometry;
			const cppGeometry = decodeRuntimeSaveState(cppBytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes).machineState.machine.geometry;
			assert.deepEqual(cppGeometry.xform, tsGeometry.xform, `${scenario.name}/${phase}: all raw XFORM latches`);
			assert.deepEqual(cppGeometry.sat, tsGeometry.sat, `${scenario.name}/${phase}: all raw SAT latches including unused tails`);
			if (scenario.name === 'xform') {
				assert.equal(tsGeometry.xform.vertices[127], 0xfedcba98, `${phase}: unused XFORM FIFO tail preserved`);
			}
			if (scenario.name === 'sat') {
				assert.equal(tsGeometry.sat.verticesA[127], 0xfedcba98, `${phase}: first unused raw tail preserved`);
				assert.equal(tsGeometry.sat.verticesB[126], 0x89abcdef, `${phase}: second unused raw tail preserved`);
			}
			const fromTs = spawnSync(runner, [...command.slice(1), 'resume', biosPath, tsState], { encoding: 'utf8' });
			const fromCpp = spawnSync(runner, [...command.slice(1), 'resume', biosPath, cppState], { encoding: 'utf8' });
			assert.equal(fromTs.status, 0, fromTs.stderr);
			assert.equal(fromCpp.status, 0, fromCpp.stderr);
			const tsFromTs = resume(tsBytes), tsFromCpp = resume(cppBytes);
			assert.equal(fromTs.stdout.trim(), tsFromTs, `C++ resumes TS ${scenario.name}/${phase} state at identical edges`);
			assert.equal(tsFromCpp, fromCpp.stdout.trim(), `TS resumes C++ ${scenario.name}/${phase} state at identical edges`);
			assert.equal(tsFromCpp, tsFromTs, `${scenario.name}/${phase} snapshot progress and visible output are equivalent`);
			const final = tsFromTs.split('\n').at(-1)!.split(' ').map(Number);
			assert.equal(final[5], GEO_STATUS_DONE, `${scenario.name}/${phase}: job completed successfully`);
			assert.equal(final[6], scenario.processed, `${scenario.name}/${phase}: processed records`);
			assert.equal(final[7], 0, `${scenario.name}/${phase}: no geometry fault`);
			assert.equal(final[8] & IRQ_GEO_DONE, IRQ_GEO_DONE, `${scenario.name}/${phase}: completion IRQ`);
			assert.deepEqual(final.slice(9, 18), scenario.result, `${scenario.name}/${phase}: exact output oracle`);
			assert.deepEqual(final.slice(18), scenario.summary, `${scenario.name}/${phase}: exact second output oracle`);
			console.log(`GEO-ACTIVE-CROSS-CORE:${scenario.name}:${phase}:PASS`);
		}
	}

} finally {
	rmSync(directory, { recursive: true, force: true });
}
