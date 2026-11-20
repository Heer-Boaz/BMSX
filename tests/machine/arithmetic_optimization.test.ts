import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { asClosure, valueBool, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runCompletionClosure } from '../helpers/cpu_test_harness';

const expressions = ['x + 0', '0 + x', 'x - 0', '0 - x', 'x * 1', '1 * x', 'x / 1', 'x ^ 1'];
for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`O3 identities preserve Integer/Float tags, rounding and NaN on backend ${backend}`, () => {
		const source = `return function(x) return ${expressions.join(', ')} end`;
		const machines = ([0, 3] as const).map(optLevel => {
			const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(source, 'identities.lua', optLevel)), backend);
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			return { cpu, closure: asClosure(materializeCpuCompletionValues(cpu)[0], cpu.gc) };
		});
		for (const input of [
			...[0, 1, -1, 16777217, -2147483648, 2147483647].map(valueInteger),
			...[0, 0x80000000, 1, 0x80000001, 0x7f7fffff, 0x7f800000, 0xff800000, 0x7fc00000, 0xffa00001].map(valueFloatBits),
		]) {
			const outputs = machines.map(({ cpu, closure }) => {
				runCompletionClosure(cpu, closure, [input]);
				return materializeCpuCompletionValues(cpu);
			});
			assert.deepEqual(outputs[1], outputs[0]);
			if (input === valueFloatBits(0x80000000)) assert.deepEqual(outputs[1], [
				0, 0, 0x80000000, 0, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
			].map(valueFloatBits));
			if (input === valueInteger(16777217)) assert.deepEqual(outputs[1], [
				input, input, input, valueInteger(-16777217), input, input, valueFloatBits(0x4b800000), valueFloatBits(0x4b800000),
			]);
			if (input === valueFloatBits(0xffa00001)) assert.deepEqual(outputs[1], expressions.map(() => valueFloatBits(0x7fc00000)));
		}
	});
	for (const optLevel of [3] as const) test(`identity rewrites do not erase non-Number faults (O${optLevel}, backend ${backend})`, () => {
		const source = `return ${expressions.map(expr => `function(x) return ${expr} end`).join(', ')}`;
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(source, 'identities.lua', optLevel)), backend);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		const initial = cpu.captureRuntimeState();
		const initialRam = cpu.memory.captureSaveState();
		for (const [index, expr] of expressions.entries()) for (const input of [valueNil(), valueBool(false), valueBool(true)]) {
			cpu.memory.restoreSaveState(initialRam);
			cpu.restoreRuntimeState(initial);
			const fn = asClosure(materializeCpuCompletionValues(cpu)[index], cpu.gc);
			cpu.beginCompletionCall(fn, [input]);
			// Stop on exception entry, before the fixture's exception vector executes.
			for (let grant = 0; grant < 16 && cpu.readExceptionReturnFrameDepth() === -1; ++grant) {
				if (cpu.runUntilDepth(0, 1) === RunResult.Halted) break;
			}
			assert.notEqual(cpu.readExceptionReturnFrameDepth(), -1, expr);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT, expr);
		}
	});
}
