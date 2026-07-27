import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	CpuProfilerSession,
	collectCpuProfilerHotPcs,
	formatCpuProfilerReport,
} from '../../scripts/bootrom/cpu_profiler';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
	type TestBlua32Image,
} from '../helpers/blua32';
import type { LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import { createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';

function makeProfilerImage() {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(code, 2, OpCode.ADD, 2, 0, 1, 0);
	writeInstruction(code, 3, OpCode.RET, 2, 1, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 }],
		debugRanges: [
			{ path: 'manual.lua', start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
			{ path: 'manual.lua', start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
			{ path: 'manual.lua', start: { line: 3, column: 1 }, end: { line: 3, column: 10 } },
			{ path: 'manual.lua', start: { line: 4, column: 1 }, end: { line: 4, column: 10 } },
		],
		functionIds: ['main'],
	});
}

function makeReloadedProfilerImage() {
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.RET, 0, 1, 0, 0);
	return linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 2, maxStack: 1 }],
		debugRanges: [
			{ path: 'reloaded.lua', start: { line: 7, column: 1 }, end: { line: 7, column: 10 } },
			{ path: 'reloaded.lua', start: { line: 8, column: 1 }, end: { line: 8, column: 10 } },
		],
		functionIds: ['reloaded'],
	});
}

function makeProfilerSources(image: TestBlua32Image) {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: '',
		namespace: 'profiler-test',
		projectRootPath: '',
		can_boot_from_source: false,
		revision: 0,
	};
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = {
		system: { layout: image.image, symbols: image.symbols },
		cartridgeSlots: [null, null],
	};
	return sources;
}

function profileImage(image: ReturnType<typeof makeProfilerImage>) {
	const cpu = createTestSystemCpu(image).cpu;
	const profilerSession = new CpuProfilerSession(cpu, makeProfilerSources(image));
	profilerSession.enable();
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const snapshot = profilerSession.snapshot();
	profilerSession.disable();
	return snapshot;
}

test('CPU profiler records opcode and PC execution counts', () => {
	const snapshot = profileImage(makeProfilerImage());
	assert.equal(snapshot.totalInstructions, 4);
	assert.equal(snapshot.totalBaseCycles, 5);
	assert.equal(snapshot.opcodeCounts[OpCode.K1], 2);
	assert.equal(snapshot.opcodeCounts[OpCode.ADD], 1);
	assert.equal(snapshot.opcodeCounts[OpCode.RET], 1);
	assert.equal(snapshot.pcCounts[0], 1);
	assert.equal(snapshot.pcCounts[1], 1);
	assert.equal(snapshot.pcCounts[2], 1);
	assert.equal(snapshot.pcCounts[3], 1);
});

test('CPU profiler report resolves hot PCs back to opcode and source location', () => {
	const snapshot = profileImage(makeProfilerImage());
	const hotAdd = collectCpuProfilerHotPcs(snapshot, 8, OpCode.ADD);
	assert.equal(hotAdd.length, 1);
	assert.equal(hotAdd[0].opcodeName, 'ADD');
	assert.equal(hotAdd[0].functionId, 'main');
	assert.equal(hotAdd[0].range?.path, 'manual.lua');
	assert.equal(hotAdd[0].range?.start.line, 3);

	const report = formatCpuProfilerReport(snapshot, { topPaths: 8, topFunctions: 8, topOpcodes: 8, topPcs: 8 });
	assert.match(report, /Fantasy CPU Runtime Profile/);
	assert.match(report, /Estimated base cycles: 5/);
	assert.match(report, /Top Paths/);
	assert.match(report, /manual\.lua instr=4/);
	assert.match(report, /Top Functions/);
	assert.match(report, /main instr=4/);
	assert.match(report, /Category Pressure/);
	assert.match(report, /Path Opcode Pressure/);
	assert.match(report, /K1=2x1=2/);
	assert.match(report, /Function Opcode Pressure/);
	assert.match(report, /Call\/Return Heavy Functions/);
	assert.match(report, /main call_ops=1 cycles=2/);
	assert.match(report, /Opcode Mix/);
	assert.match(report, /ADD count=1 share=25\.00% cost=1 cycles=1/);
	assert.match(report, /manual\.lua:3:1/);
	assert.match(report, /function=main/);
});

test('CPU profiler starts a new profiling epoch when IDE tooling media changes', () => {
	const initial = makeProfilerImage();
	const reloaded = makeReloadedProfilerImage();
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(initial);
	const sources = makeProfilerSources(initial);
	const profilerSession = new CpuProfilerSession(cpu, sources);
	profilerSession.enable();

	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.equal(profilerSession.snapshot().totalInstructions, 4);

	memory.installSystemRom(reloaded.romBytes);
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	sources.currentBlua32Media = {
		system: { layout: reloaded.image, symbols: reloaded.symbols },
		cartridgeSlots: [null, null],
	};

	const resetSnapshot = profilerSession.snapshot();
	assert.equal(resetSnapshot.totalInstructions, 0);
	assert.equal(resetSnapshot.pcCounts.length, 2);
	assert.deepEqual(resetSnapshot.functionIds, ['reloaded']);

	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const snapshot = profilerSession.snapshot();
	profilerSession.disable();

	assert.equal(snapshot.totalInstructions, 2);
	assert.equal(snapshot.opcodeCounts[OpCode.ADD], 0);
	assert.equal(snapshot.opcodeCounts[OpCode.K1], 1);
	assert.equal(snapshot.opcodeCounts[OpCode.RET], 1);
	assert.equal(snapshot.pcCounts.length, 2);
	assert.equal(snapshot.debugRanges[0]?.path, 'reloaded.lua');
	assert.deepEqual(snapshot.functionIds, ['reloaded']);
});
