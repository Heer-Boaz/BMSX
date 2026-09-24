import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH } from '../helpers/scenario_media';
import { buildTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { TestTarget } from '../../ide/testing/target';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { TestExecution, DEFAULT_TEST_BUDGETS } from '../../ide/testing/execution';
import { ScenarioResultService } from '../../ide/testing/scenario/result_service';
import type { ScenarioTestItem } from '../../ide/testing/scenario/test_collection';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread';

const source = `
return {
 kind = 'unit',
 setup = function(t, fixture) fixture.count = 9 end,
 teardown = function(t, fixture) assert(fixture.count == 10); t:log('cleanup') end,
 tests = {
   success = function(t, fixture) fixture.count = fixture.count + 1; t:log('body'); return false end,
   failure = function(t, fixture) fixture.count = 10; error('authored failure') end,
   cleanup_failure = function(t, fixture) error('body failure') end,
   timeout = function(t, fixture) while true do fixture.count = 10 end end,
   unit_wait = function(t, fixture) fixture.count = 10; t:wait_ticks(1) end,
 },
}`;

for (const optLevel of [0, 3] as const) {
test(`O${optLevel}: named cases use fresh machines, fixture hooks, retained failures and bounded execution`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-runner-'));
	try {
		const testSource = { path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source };
		const fixture = await buildScenarioMediaFixture(directory, [testSource], {
			systemSource: `module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]`,
			systemModules: [
				{ path: 'base', source: `local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable` },
				{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
			],
			cartSource: `module<entry>\nerror('game entry must never run in a unit target')`,
		});
		const program = await buildTestCartridge({ ...fixture, systemRom: fixture.systemRom, cartridge: fixture.cartRom,
			test: { sourcePath: testSource.path, source }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
		const results = new ScenarioResultService();
		const items: ScenarioTestItem[] = program.suite.tests.map(test => ({
			kind: 'test', id: `scenario:0:${test.name}`, parentId: 'scenario-module:0:fixture', label: test.name,
			caseName: test.name, resource: { domain: 0, path: testSource.path }, assetId: 'fixture', sourceTimestamp: 0, range: test.range,
		}));
		const run = results.beginRun('scenario-root:0', items.map(test => ({ test, source, sourceRevision: 0 })));
		let previous: TestTarget | null = null;
		for (let index = 0; index < items.length; index += 1) {
			const target = new OffscreenMachine(fixture.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
			Object.defineProperties(target, {
				backend: { get() { assert.fail('source-only unit cases must not initialize a renderer'); } },
				presenter: { get() { assert.fail('source-only unit cases must not initialize a presenter'); } },
			});
			if (previous !== null) assert.notEqual(previous.runtime.machine.cpu, target.runtime.machine.cpu);
			const result = results.startItem(run, index, 0);
			const execution = new TestExecution(target, program, results, result, { ...DEFAULT_TEST_BUDGETS, phaseCycles: 20000 });
			for (let grant = 0; execution.active && grant < 10000; grant += 1) execution.advance();
			assert.equal(execution.active, false);
			assert.equal(target.runtime.frameScheduler.lastTickSequence, 0, 'unit execution requires no game ticks');
			if (index === 0) {
				assert.equal(result.state, 'passed', JSON.stringify(result.failures));
				assert.deepEqual([result.logs.at(0).text, result.logs.at(1).text], ['body', 'cleanup']);
			} else {
				assert.equal(result.state, 'failed');
				assert.equal(result.failures[0].phase, 'body');
				assert.equal(result.failures[0].location?.resource.path, index === 4 ? 'testlib/context.lua' : testSource.path);
				assert.ok(result.failures[0].stackTrace!.includes(testSource.path));
				if (index === 1) {
					assert.equal(result.logs.at(0).text, 'cleanup');
					assert.ok(target.runtime.machine.cpu.captureRuntimeState().threads.some(thread => thread.status === ThreadStatus.Failed && thread.frames.length > 0));
				} else if (index === 2) assert.deepEqual(result.failures.map(failure => failure.phase), ['body', 'teardown']);
				else if (index === 3) {
					assert.match(result.failures[0].message, /cycle budget/);
					const inspection = execution.inspect();
					const failure = inspection.state.failures[0];
					assert.equal(failure.origin, 'quarantined-cpu');
					const frame = inspection.readStack(failure.reference!, 0, 1).frames[0];
					assert.equal(frame.pc, target.runtime.machine.cpu.readFramePc(frame.physicalFrameIndex), 'quarantine describes next/current PC, not a throw');
					const scopes = inspection.frameScopes(frame.reference).scopes;
					assert.ok(scopes.some(scope => scope.status === 'available'));
					inspection.dispose();
				}
				else assert.match(result.failures[0].message, /requires an integration test/);
			}
			previous = target;
			execution.dispose();
		}
		results.completeRun(run);
		assert.equal(run.passedCount, 1);
		assert.equal(run.failedCount, 4);
		const setupSource = `return { kind = 'unit',
 setup = function(t, fixture) fixture.started = true; error('setup failed') end,
 teardown = function(t, fixture) assert(fixture.started); error('cleanup failed') end,
 tests = { never = function() error('body must not run') end }
}`;
		const setupProgram = await buildTestCartridge({ systemRom: fixture.systemRom, cartridge: fixture.cartRom,
			test: { sourcePath: testSource.path, source: setupSource }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
		const setupTarget = new OffscreenMachine(fixture.systemRom, [setupProgram.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
		const setupItem = { ...items[0], caseName: 'never' };
		const setupRun = results.beginRun(setupItem.id, [{ test: setupItem, source: setupSource, sourceRevision: 1 }]);
		const setupResult = results.startItem(setupRun, 0, 0);
		const setupExecution = new TestExecution(setupTarget, setupProgram, results, setupResult);
		for (let grant = 0; setupExecution.active && grant < 1000; grant++) setupExecution.advance();
		assert.equal(setupExecution.active, false);
		assert.deepEqual(setupResult.failures.map(failure => [failure.phase, failure.message]),
			[['setup', 'setup failed'], ['teardown', 'cleanup failed']]);
		setupTarget.dispose();
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test(`O${optLevel}: integration code waits sequentially, injects ICU samples, stops at publication and captures an accepted frame`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-integration-runner-'));
	try {
		const source = `local game<const> = require('game')
return { kind = 'integration', tests = {
 input_and_boundary = function(t)
  t:wait_until('game starts', function() return game.updates >= 2 end, 10)
  t:press('KeyA', 3)
  assert(game.down_samples == 3)
  assert(mem[0x0800006c] & 0x10 == 0)
  local receipt = { reached = false }
  game.receipt = receipt
  t:at_boundary(receipt, 10)
  assert(game.after_publication == 0)
  t:wait_ticks(2)
  assert(game.after_publication == 1)
  t:capture('accepted')
 end,
} }`;
		const fixture = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
			systemSource: `module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]`,
			systemModules: [
				{ path: 'base', source: `local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable` },
				{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
			],
			cartModules: [{ path: 'game', source: `return { updates = 0, down_samples = 0, after_publication = 0 }` }],
			cartSource: `module<entry>
local game<const> = require('game')
function irq(flags)
 if mem[0x0800006c] & 0x10 ~= 0 then game.down_samples = game.down_samples + 1 end
 mem[0x08000064] = 1
 mem[0x08000004] = flags
end
mem[0x08000064] = 1
mem[0x08000008] = 4
while true do
 game.updates = game.updates + 1
 if game.receipt ~= nil then
  game.receipt.reached = true
  game.after_publication = 1
 end
 halt_until_irq
end`,
		});
		const program = await buildTestCartridge({ systemRom: fixture.systemRom, cartridge: fixture.cartRom,
			test: { sourcePath: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
		const target = new OffscreenMachine(fixture.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
		const results = new ScenarioResultService();
		const item: ScenarioTestItem = { kind: 'test', id: 'scenario:0:integration', caseName: 'input_and_boundary',
			parentId: 'scenario-module:0:fixture', label: 'input_and_boundary', assetId: 'fixture', sourceTimestamp: 0,
			resource: { domain: 0, path: SCENARIO_FIXTURE_TEST_SOURCE_PATH }, range: program.suite.tests[0].range };
		const run = results.beginRun(item.id, [{ test: item, source, sourceRevision: 0 }]);
		const result = results.startItem(run, 0, 0);
		let captures = 0;
		const execution = new TestExecution(target, program, results, result, DEFAULT_TEST_BUDGETS, (captured, label) => {
			assert.equal(label, 'accepted');
			assert.ok(captured.backend.framebufferPixels.length > 0);
			captures += 1;
		});
		for (let grant = 0; execution.active && grant < 10000; grant += 1) execution.advance();
		assert.equal(execution.active, false);
		assert.equal(result.state, 'passed', JSON.stringify(result.failures));
		assert.equal(captures, 1);
		assert.ok(result.captures.at(0).presentedFrame! > 0);
		target.dispose();
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test(`O${optLevel}: cooperative and uncooperative cancellation have bounded, independent cleanup`, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-cleanup-'));
	try {
		const source = `return { kind = 'integration',
 setup = function(t, fixture) fixture.started = true; t:log('setup') end,
 teardown = function(t, fixture)
  assert(fixture.started); t:log('cleanup'); t:wait_ticks(1)
  cleanup_receipt = { reached = false }
  t:at_boundary(cleanup_receipt, 10)
  assert(not after_cleanup_boundary)
 end,
 tests = {
  waiting = function(t) t:wait_ticks(100); error('cancelled body resumed') end,
  spinning = function() while true do end end,
 }
}`;
		const fixture = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
			systemSource: `module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]`,
			systemModules: [
				{ path: 'base', source: `local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable` },
				{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
			], cartSource: `module<entry>
function irq(flags) mem[0x08000004] = flags end
mem[0x08000008] = 4
while true do
 if cleanup_receipt then cleanup_receipt.reached = true; after_cleanup_boundary = true end
 halt_until_irq
end`,
		});
		const program = await buildTestCartridge({ systemRom: fixture.systemRom, cartridge: fixture.cartRom,
			test: { sourcePath: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
		for (const caseName of ['waiting', 'spinning']) {
			const target = new OffscreenMachine(fixture.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
			const results = new ScenarioResultService();
			const declaration = program.suite.tests.find(test => test.name === caseName)!;
			const item: ScenarioTestItem = { kind: 'test', id: `scenario:0:${caseName}`, caseName,
				parentId: 'scenario-module:0:fixture', label: caseName, assetId: 'fixture', sourceTimestamp: 0,
				resource: { domain: 0, path: SCENARIO_FIXTURE_TEST_SOURCE_PATH }, range: declaration.range };
			const run = results.beginRun(item.id, [{ test: item, source, sourceRevision: 0 }]);
			const result = results.startItem(run, 0, 0);
			const execution = new TestExecution(target, program, results, result);
			// Setup's log yield, setup return, then a body yield or one busy CPU grant.
			for (let grant = 0; result.logs.length === 0 && grant < 1000; grant++) execution.advance();
			execution.advance(); execution.advance();
			execution.cancel();
			for (let grant = 0; execution.active && grant < 1000; grant++) { execution.cancel(); execution.advance(); }
			assert.equal(execution.active, false);
			assert.equal(result.state, 'cancelled');
			assert.equal(result.logs.length, caseName === 'waiting' ? 2 : 1);
			if (caseName === 'waiting') {
				assert.equal(result.logs.at(1).text, 'cleanup');
				assert.deepEqual(result.failures, []);
			} else assert.match(result.failures[0].message, /Cleanup incomplete/);
			target.dispose();
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

}
