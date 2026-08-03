import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	RuntimeDebuggerPlanResult,
	RuntimeDebuggerPlanManager,
	type RuntimeDebuggerControlPlan,
} from '../../ide/runtime/debugger_plans';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

function controlPlan(
	events: string[],
	name: string,
	result: RuntimeDebuggerPlanResult,
): RuntimeDebuggerControlPlan {
	return {
		executionDomainMask: 2,
		preMaskableInterruptDomainMask: 2,
		shouldStop: (domain, pc) => domain === 0 && pc === 12,
		willExecute: () => events.push(`${name}:will`),
		didExecute: () => {
			events.push(`${name}:did`);
			return result;
		},
		didFault: () => {
			events.push(`${name}:fault`);
			return RuntimeDebuggerPlanResult.Complete;
		},
		discard: () => events.push(`${name}:discard`),
	};
}

test('runtime debugger control plans own replacement, execution, and fault lifecycles', () => {
	const events: string[] = [];
	const plans = new RuntimeDebuggerPlanManager();
	plans.pushControlPlan(controlPlan(events, 'first', RuntimeDebuggerPlanResult.Active));
	assert.equal(plans.willExecute(), false);
	assert.equal(plans.didExecute(), false);
	plans.pushControlPlan(controlPlan(events, 'second', RuntimeDebuggerPlanResult.Complete));

	assert.equal(plans.controlActive, true);
	assert.equal(plans.executionDomainMask, 2);
	assert.equal(plans.preMaskableInterruptDomainMask, 2);
	assert.equal(plans.shouldStop(0, 12), true);
	assert.equal(plans.willExecute(), false);
	assert.equal(plans.didExecute(), true);
	assert.equal(plans.controlActive, false);
	assert.deepEqual(events, [
		'first:will',
		'first:did',
		'first:discard',
		'second:will',
		'second:did',
	]);

	plans.pushControlPlan(controlPlan(events, 'faulted', RuntimeDebuggerPlanResult.Active));
	assert.equal(plans.didFault(), true);
	assert.equal(plans.controlActive, false);
	assert.deepEqual(events, [
		'first:will',
		'first:did',
		'first:discard',
		'second:will',
		'second:did',
		'faulted:fault',
	]);
});

test('completed control plan publishes a binding change after its hook drops the masks', () => {
	let executionDomainMask = 2;
	const plan: RuntimeDebuggerControlPlan = {
		get executionDomainMask() {
			return executionDomainMask;
		},
		get preMaskableInterruptDomainMask() {
			return executionDomainMask;
		},
		shouldStop: () => {
			executionDomainMask = 0;
			return true;
		},
		willExecute: () => {},
		didExecute: () => RuntimeDebuggerPlanResult.Complete,
		didFault: () => RuntimeDebuggerPlanResult.Complete,
		discard: () => {},
	};
	const plans = new RuntimeDebuggerPlanManager();
	plans.pushControlPlan(plan);

	assert.equal(plans.shouldStop(0, 12), true);
	assert.equal(plans.executionDomainMask, 0);
	assert.equal(plans.didExecute(), true);
	assert.equal(plans.controlActive, false);
});

test('completion batches retain the physical LIFO root order until every root completes', () => {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CLOSURE, 0, 0, 1, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(code, 3, OpCode.NEWT, 0, 0, 0, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 1, 0, 0);
	writeInstruction(code, 5, OpCode.RFE, 0, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [
			{ firstWord: 0, wordCount: 3 },
			{ firstWord: 3, wordCount: 2, maxStack: 1 },
			{ firstWord: 5, wordCount: 1 },
		],
		startupFunctionIndex: 0,
		irqFunctionIndex: 2,
		exceptionFunctionIndex: 2,
	});
	const { cpu } = createTestSystemCpu(image);
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	const closure = materializeCpuCompletionValues(cpu)[0] as Closure;
	const firstFrameIndex = cpu.getFrameDepth();
	cpu.beginCompletionCall(closure);
	cpu.beginCompletionCall(closure);

	const plans = new RuntimeDebuggerPlanManager();
	plans.pushCompletionBatch(cpu, firstFrameIndex, [0, SYSTEM_EXECUTION_DOMAIN_ID]);
	const topRootBatch = plans.completionBatchAtFrame(firstFrameIndex + 1);
	assert.ok(topRootBatch);
	assert.deepEqual(
		topRootBatch.executionDomains.slice(0, 2),
		[0, SYSTEM_EXECUTION_DOMAIN_ID],
		'a top-root fault leaves both the lower cart root and top system root incomplete',
	);

	assert.equal(cpu.runUntilDepth(firstFrameIndex + 1, 100), RunResult.Halted);
	plans.pruneCompletedCompletionBatches();
	const lowerRootBatch = plans.completionBatchAtFrame(firstFrameIndex);
	assert.ok(lowerRootBatch);
	assert.deepEqual(
		lowerRootBatch.executionDomains.slice(0, 1),
		[0],
		'after the top root returns, only the lower cart root remains incomplete',
	);

	assert.equal(cpu.runUntilDepth(firstFrameIndex, 100), RunResult.Halted);
	plans.pruneCompletedCompletionBatches();
	assert.equal(plans.completionBatchAtFrame(firstFrameIndex), null);
});
