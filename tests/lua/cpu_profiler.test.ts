import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CPU, OpCode, RunResult, type Program, type ProgramMetadata, type Proto } from '../../src/bmsx/machine/cpu/cpu';
import { collectCpuProfilerHotPcs } from '../../src/bmsx/machine/cpu/cpu_profiler';
import { writeInstruction, INSTRUCTION_BYTES } from '../../src/bmsx/machine/cpu/instruction_format';
import { Memory } from '../../src/bmsx/machine/memory/memory';

function makeProto(codeLen: number): Proto {
	return {
		entryPC: 0,
		codeLen,
		numParams: 0,
		isVararg: false,
		maxStack: 3,
		upvalueDescs: [],
	};
}

function makeProgram(cpu: CPU): Program {
	const code = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.K1, 1, 0, 0, 0);
	writeInstruction(code, 2, OpCode.ADD, 2, 0, 1, 0);
	writeInstruction(code, 3, OpCode.RET, 2, 1, 0, 0);
	const pool = cpu.getStringPool();
	return {
		code,
		constPool: [],
		protos: [makeProto(code.length)],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

function makeMetadata(): ProgramMetadata {
	return {
		debugRanges: [
			{ path: 'manual.lua', start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
			{ path: 'manual.lua', start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
			{ path: 'manual.lua', start: { line: 3, column: 1 }, end: { line: 3, column: 10 } },
			{ path: 'manual.lua', start: { line: 4, column: 1 }, end: { line: 4, column: 10 } },
		],
		protoIds: ['main'],
		localSlotsByProto: [[]],
		globalNames: [],
		systemGlobalNames: [],
	};
}

test('CPU profiler records opcode and PC execution counts', () => {
	const memory = new Memory({ engineRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.setProfilerEnabled(true);
	cpu.start(0);

	assert.equal(cpu.run(1000), RunResult.Halted);

	const snapshot = cpu.getProfilerSnapshot();
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
	const memory = new Memory({ engineRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(makeProgram(cpu), makeMetadata());
	cpu.setProfilerEnabled(true);
	cpu.start(0);

	assert.equal(cpu.run(1000), RunResult.Halted);

	const snapshot = cpu.getProfilerSnapshot();
	const hotAdd = collectCpuProfilerHotPcs(snapshot, 8, OpCode.ADD);
	assert.equal(hotAdd.length, 1);
	assert.equal(hotAdd[0].opcodeName, 'ADD');
	assert.equal(hotAdd[0].protoId, 'main');
	assert.equal(hotAdd[0].range?.path, 'manual.lua');
	assert.equal(hotAdd[0].range?.start.line, 3);

	const report = cpu.formatProfilerReport({ topPaths: 8, topProtos: 8, topOpcodes: 8, topPcs: 8 });
	assert.match(report, /Fantasy CPU Runtime Profile/);
	assert.match(report, /Estimated base cycles: 5/);
	assert.match(report, /Top Paths/);
	assert.match(report, /manual\.lua instr=4/);
	assert.match(report, /Top Protos/);
	assert.match(report, /main instr=4/);
	assert.match(report, /Category Pressure/);
	assert.match(report, /Path Opcode Pressure/);
	assert.match(report, /K1=2x1=2/);
	assert.match(report, /Proto Opcode Pressure/);
	assert.match(report, /Call\/Return Heavy Protos/);
	assert.match(report, /main call_ops=1 cycles=2/);
	assert.match(report, /Opcode Mix/);
	assert.match(report, /ADD count=1 share=25\.00% cost=1 cycles=1/);
	assert.match(report, /manual\.lua:3:1/);
	assert.match(report, /proto=main/);
});
