import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareLuaLiteral } from '../../ide/runtime/lua_literal';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { valueString, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`local roots own nested host literal materialization and release nested scopes (O${optLevel})`, t => {
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'local_roots.lua', optLevel)));
		const baseline = cpu.collectTrackedHeapBytes();
		const intern = cpu.stringPool.intern.bind(cpu.stringPool);
		t.mock.method(cpu.stringPool, 'intern', (text: string, tracked = true) => {
			const id = intern(text, tracked);
			cpu.collectTrackedHeapBytes();
			return id;
		});
		const outer = cpu.acquireLocalRoots();
		try {
			const value = prepareLuaLiteral('{ local_root_key = "outer-payload", child = { "nested-payload" } }')(cpu) as Table;
			assert.equal(cpu.stringPool.toString((value.getStringKey(cpu.stringPool.find('local_root_key')!) as StringValue).id), 'outer-payload');
			const child = value.getStringKey(cpu.stringPool.find('child')!) as Table;
			assert.equal(cpu.stringPool.toString((child.getInteger(1) as StringValue).id), 'nested-payload');
			const inner = cpu.acquireLocalRoots();
			try {
				cpu.stringPool.intern('inner-only-payload');
				assert.notEqual(cpu.stringPool.find('inner-only-payload'), undefined);
			} finally {
				cpu.releaseLocalRoots(inner);
			}
			cpu.collectTrackedHeapBytes();
			assert.equal(cpu.stringPool.find('inner-only-payload'), undefined);
			assert.notEqual(cpu.stringPool.find('outer-payload'), undefined);
		} finally {
			cpu.releaseLocalRoots(outer);
		}
		assert.equal(cpu.collectTrackedHeapBytes(), baseline);
		assert.equal(cpu.stringPool.find('outer-payload'), undefined);
		assert.equal(cpu.stringPool.find('nested-payload'), undefined);
	});

	for (const explicitDomain of [false, true]) {
		test(`external call arguments survive stack-growth collection (O${optLevel}, explicit domain ${explicitDomain})`, t => {
			const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(
				'local holder = {1}; return function(...) if holder[1] == 1 then return ... end end', 'call_roots.lua', optLevel,
			)));
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			const completion: Value[] = [];
			cpu.readCompletionValues(completion);
			const closure = completion[0] as Closure;
			const args: Value[] = [];
			const strings = Array.from({ length: 24 }, (_, index) => `host-argument-${index}`);
			const roots = cpu.acquireLocalRoots();
			try {
				for (const text of strings) args.push(valueString(cpu.stringPool.intern(text)));
			} finally {
				cpu.releaseLocalRoots(roots);
			}
			const gc = t.mock.method(cpu, 'collectTrackedHeapBytes');
			const heap = cpu.luaHeap.captureState();
			cpu.luaHeap.restoreState({ ...heap, nextCollectionBytes: 0 });
			if (explicitDomain) cpu.beginCompletionClosureInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, closure, args);
			else cpu.beginCompletionCall(closure, args);
			assert.ok(gc.mock.callCount() > 0, 'actual call entry must grow the stack and collect before copying host arguments');
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			cpu.readCompletionValues(completion);
			assert.deepEqual(completion.map(value => cpu.stringPool.toString((value as StringValue).id)), strings);
		});
	}
}
