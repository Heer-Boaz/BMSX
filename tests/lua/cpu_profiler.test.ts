import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OpCode, RunResult } from '../../machine/ts/machine/cpu/cpu';
import {
	CpuProfilerSession,
	collectCpuProfilerHotPcs,
	formatCpuProfilerReport,
} from '../../machine/ts/machine/cpu/profiler';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/machine/cpu/instruction_format';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

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

function profileImage(image: ReturnType<typeof makeProfilerImage>) {
	const cpu = createTestSystemCpu(image).cpu;
	const profilerSession = new CpuProfilerSession(cpu);
	profilerSession.attachDebugInfo(-1, image.symbols.metadata.functionIds, image.symbols.metadata);
	profilerSession.enable();
	cpu.start(image.vectors.startupFunctionAddress);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	return profilerSession.profiler.snapshot();
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
