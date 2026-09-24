import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	RuntimeDebuggerPlanResult,
	RuntimeDebuggerPlanManager,
	type RuntimeDebuggerControlPlan,
	type RuntimeDebuggerCompletionResult,
} from '../../ide/runtime/debugger_plans';
import { compileCoroutineTest } from '../helpers/coroutine';
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
		honorUserStops: false,
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

test('workbench evaluation suspension retains its plan and mutation ownership', () => {
	const events: string[] = [];
	const plans = new RuntimeDebuggerPlanManager();
	plans.pushControlPlan(controlPlan(events, 'call', RuntimeDebuggerPlanResult.Active), 'workbench');
	assert.equal(plans.workbenchControlActive, true);
	assert.equal(plans.workbenchExecutionRequested, true);
	plans.setControlSuspended(true);
	assert.equal(plans.controlSuspended, true);
	assert.equal(plans.controlExecutionRequested, false);
	assert.equal(plans.workbenchExecutionRequested, false);
	assert.equal(plans.mutationActive, true);
	assert.equal(plans.shouldStop(0, 44), true);
	assert.deepEqual(events, [], 'pausing does not discard or unwind the operation');
	plans.setControlSuspended(false);
	assert.equal(plans.shouldStop(0, 44), false);
	assert.equal(plans.workbenchExecutionRequested, true);
	plans.discardAll();
	assert.equal(plans.workbenchControlActive, false);
	assert.equal(plans.controlSuspended, false);
	assert.equal(plans.controlExecutionRequested, false);
	assert.deepEqual(events, ['call:discard']);

	plans.pushControlPlan(controlPlan(events, 'recovery', RuntimeDebuggerPlanResult.Complete));
	assert.equal(plans.controlExecutionRequested, true);
	assert.equal(plans.workbenchExecutionRequested, false, 'recovery keeps the ordinary foreground execution policy');
	plans.didExecute();
	assert.equal(plans.controlExecutionRequested, false);
});

test('a faulted retained evaluation requires explicit recovery rather than running behind the editor', () => {
	const plans = new RuntimeDebuggerPlanManager();
	const plan = controlPlan([], 'call', RuntimeDebuggerPlanResult.Active);
	plan.didFault = () => RuntimeDebuggerPlanResult.Active;
	plans.pushControlPlan(plan, 'workbench');
	plans.didFault();
	assert.equal(plans.controlSuspended, true);
	assert.equal(plans.workbenchExecutionRequested, false);
	assert.equal(plans.mutationActive, true);
	plans.pushControlPlan(controlPlan([], 'recovery', RuntimeDebuggerPlanResult.Complete));
	assert.equal(plans.controlSuspended, false);
	assert.equal(plans.controlExecutionRequested, true);
});

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
		honorUserStops: false,
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

function completionFixture() {
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
	return { cpu, closure };
}

test('completion batches retain the physical LIFO root order until every root completes', () => {
	const { cpu, closure } = completionFixture();
	const firstFrameIndex = cpu.getFrameDepth();
	cpu.beginCompletionCall(closure);
	cpu.beginCompletionCall(closure);

	const plans = new RuntimeDebuggerPlanManager();
	const events: RuntimeDebuggerCompletionResult[] = [];
	plans.pushCompletionBatch(cpu.activeThread, firstFrameIndex, [0, SYSTEM_EXECUTION_DOMAIN_ID], result => events.push(result));
	const topRootBatch = plans.completionBatchAtFrame(cpu.activeThread, firstFrameIndex + 1);
	assert.ok(topRootBatch);
	assert.deepEqual(
		topRootBatch.executionDomains.slice(0, 2),
		[0, SYSTEM_EXECUTION_DOMAIN_ID],
		'a top-root fault leaves both the lower cart root and top system root incomplete',
	);

	assert.equal(cpu.runUntilDepth(firstFrameIndex + 1, 100), RunResult.Halted);
	plans.pruneCompletedCompletionBatches();
	assert.deepEqual(events, [], 'one returning root does not finish the batch');
	const lowerRootBatch = plans.completionBatchAtFrame(cpu.activeThread, firstFrameIndex);
	assert.ok(lowerRootBatch);
	assert.deepEqual(
		lowerRootBatch.executionDomains.slice(0, 1),
		[0],
		'after the top root returns, only the lower cart root remains incomplete',
	);

	assert.equal(cpu.runUntilDepth(firstFrameIndex, 100), RunResult.Halted);
	plans.pruneCompletedCompletionBatches();
	assert.equal(plans.completionBatchAtFrame(cpu.activeThread, firstFrameIndex), null);
	assert.deepEqual(events, [{ status: 'completed' }]);
});


test('nested init batches complete independently; physical fault settles retained roots only once', () => {
	const { cpu, closure } = completionFixture();
	const plans = new RuntimeDebuggerPlanManager();
	const events: string[] = [];
	const depth = cpu.getFrameDepth();
	cpu.beginCompletionCall(closure);
	plans.pushCompletionBatch(cpu.activeThread, depth, [0], result => events.push(`old:${result.status}`));
	cpu.beginCompletionCall(closure);
	plans.pushCompletionBatch(cpu.activeThread, depth + 1, [0], result => events.push(`new:${result.status}`));
	assert.equal(cpu.runUntilDepth(depth + 1, 100), RunResult.Halted);
	plans.faultCompletionBatches(7);
	assert.deepEqual(events, ['new:completed', 'old:faulted'], 'completed init cannot inherit a later fault');
	assert.ok(plans.completionBatchAtFrame(cpu.activeThread, depth), 'faulted roots retain recovery metadata');
	plans.faultCompletionBatches(8);
	plans.discardCompletionBatchesFrom(cpu.activeThread, depth);
	assert.deepEqual(events, ['new:completed', 'old:faulted'], 'recovery cannot change the terminal outcome');
	assert.equal(plans.mutationActive, false);
});

test('discard notifies every pending completion observer', () => {
	const { cpu, closure } = completionFixture();
	const plans = new RuntimeDebuggerPlanManager();
	const events: RuntimeDebuggerCompletionResult[] = [];
	const depth = cpu.getFrameDepth();
	cpu.beginCompletionCall(closure);
	plans.pushCompletionBatch(cpu.activeThread, depth, [0], result => events.push(result));
	plans.discardAll();
	plans.discardAll();
	assert.deepEqual(events, [{ status: 'discarded' }]);
	assert.equal(cpu.getFrameDepth(), depth + 1, 'observer disposal never unwinds guest execution');
});

test('completion follows the actual root thread across guest coroutine switches', () => {
	const { cpu } = createTestSystemCpu(compileCoroutineTest(`
function probe()
 local co = coroutine.create(function() local n = 0; for i=1,20 do n = n + i end; return n end)
 local ok, value = coroutine.resume(co)
 assert(ok and value == 210)
end
halt_until_irq`, 0));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const thread = cpu.activeThread, depth = cpu.getFrameDepth();
	cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('probe')) as Closure);
	const plans = new RuntimeDebuggerPlanManager();
	const events: RuntimeDebuggerCompletionResult[] = [];
	plans.pushCompletionBatch(thread, depth, [SYSTEM_EXECUTION_DOMAIN_ID], result => events.push(result));
	let switched = false;
	for (let grant = 0; grant < 10000 && thread.frames.length > depth; grant++) {
		cpu.runUntilDepth(depth, 1, thread);
		plans.pruneCompletedCompletionBatches();
		if (cpu.activeThread !== thread) {
			switched = true;
			assert.deepEqual(events, [], 'a child coroutine is not the init completion root');
			assert.equal(plans.completionBatchAtFrame(cpu.activeThread, depth), null);
			assert.ok(plans.completionBatchAtFrame(thread, depth));
		}
	}
	assert.equal(switched, true, 'test actually executed the retained child thread');
	assert.equal(thread.frames.length, depth);
	assert.deepEqual(events, [{ status: 'completed' }]);
});
