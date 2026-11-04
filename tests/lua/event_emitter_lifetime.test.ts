import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_FAULT_REASON_CALL_NON_FUNCTION } from '../../machine/ts/spec/blua32/cop0';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';

const setup = `
local events<const> = require('cartlib/event_emitter')
local source<const> = { id = 'event.fixture' }
local port<const> = events.events_of(source)
`;

const recoveryVectors = {
	scoped_identity_namespace: `
local ids<const> = { '_scope_count', 'count', 'listeners', 'by_emitter', 'first', 'last',
 '_event_name', '_emitter_id', false, 0, '' }
local sources<const>, ports<const>, calls<const> = {}, {}, {}
local receive<const> = function(self, event, emitter, payload, emitter_id)
 assert(event == 'identity' and emitter == self and emitter_id == self.id and payload == self.slot,
  'scoped dispatch confused emitter identity with index metadata')
 calls[self.slot] = calls[self.slot] + 1
end
for index = 1, #ids do
 local source<const> = { id = ids[index], slot = index }
 local port<const> = events.events_of(source)
 sources[index], ports[index], calls[index] = source, port, 0
 port:on({ event = 'identity', handler = receive })
end
for index = 1, #ports do ports[index]:emit('identity', index) end
for index = 1, #calls do assert(calls[index] == 1, 'a scoped identity admitted another emitter') end
for index = 1, #sources do
 local source<const> = sources[index]
 if index % 2 == 0 then events:remove_subscriber(source)
 else events:off('identity', source, receive, source.id) end
end
assert(next(events._scoped_listeners) == nil and next(events._subscriptions_by_subscriber) == nil,
 'removing the final emitter did not retire its event scope')
ports[1]:on({ event = 'identity', handler = receive, once = true })
ports[1]:emit('identity', 1)
assert(calls[1] == 2 and next(events._scoped_listeners) == nil,
 'a retired event scope could not be recreated and retired independently')
return true`,
	inner_caught: `
local failure<const>, removed<const>, tail<const> = {}, {}, {}
local outer_calls, inner_calls, global_calls = 0, 0, 0
events:on({ event = 'inner', emitter = source.id, subscriber = source, once = true,
 handler = function()
  inner_calls = inner_calls + 1
  events:remove_subscriber(removed)
  error(failure)
 end })
events:on({ event = 'inner', emitter = source.id, subscriber = removed,
 handler = function() error('removed inner peer ran') end })
events:on({ event = 'inner', subscriber = tail,
 handler = function() global_calls = global_calls + 1 end })
events:on({ event = 'outer', emitter = source.id, subscriber = source, once = true,
 handler = function()
  outer_calls = outer_calls + 1
  local ok<const>, value<const> = pcall(port.emit, port, 'inner')
  assert(not ok and value == failure, 'inner error identity changed')
 end })
events:on({ event = 'outer', subscriber = tail,
 handler = function() outer_calls = outer_calls + 1 end })
port:emit('outer')
assert(outer_calls == 2 and inner_calls == 1 and global_calls == 0,
 'inner failure failed to abort its remaining handlers or aborted the recovered outer event')
port:emit('inner')
assert(inner_calls == 1 and global_calls == 1, 'once or peer removal was lost during error unwinding')
events:remove_subscriber(tail)
assert(next(events._subscriptions_by_subscriber) == nil)
assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
return true`,
	outer_caught: `
local failure<const>, peer<const>, tail<const> = {}, {}, {}
local reached_tail = false
events:on({ event = 'inner', emitter = source.id, subscriber = source, once = true,
 handler = function() error(failure) end })
events:on({ event = 'outer', emitter = source.id, subscriber = source, once = true,
 handler = function()
  events:remove_subscriber(peer)
  port:emit('inner')
  error('failing inner emission returned normally')
 end })
events:on({ event = 'outer', emitter = source.id, subscriber = peer,
 handler = function() error('removed outer peer ran') end })
events:on({ event = 'outer', subscriber = tail,
 handler = function() reached_tail = true end })
local ok<const>, value<const> = pcall(port.emit, port, 'outer')
assert(not ok and value == failure, 'nested propagation replaced the original error object')
assert(not reached_tail, 'failed emission continued dispatching')
port:emit('outer')
assert(reached_tail, 'emitter did not recover after nested propagation')
events:remove_subscriber(tail)
assert(next(events._subscriptions_by_subscriber) == nil)
assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
return true`,
	remove_tail_and_append: `
local head<const>, middle<const>, tail<const>, added<const> = {}, {}, {}, {}
local calls = ''
local replaced = false
local add<const> = function() calls = calls .. 'D' end
events:on({ event = 'replace', subscriber = head, handler = function()
 calls = calls .. 'A'
 if not replaced then
  replaced = true
  events:remove_subscriber(tail)
  events:on({ event = 'replace', subscriber = added, handler = add })
 end
end })
events:on({ event = 'replace', subscriber = middle, handler = function() calls = calls .. 'B' end })
events:on({ event = 'replace', subscriber = tail, handler = function() error('removed tail ran') end })
port:emit('replace')
assert(calls == 'AB', 'tail replacement ran a newly appended listener in the current emission')
port:emit('replace')
assert(calls == 'ABABD', 'tail replacement failed to admit the listener on the next emission')
events:remove_subscriber(head)
events:remove_subscriber(middle)
events:remove_subscriber(added)
assert(next(events._subscriptions_by_subscriber) == nil and next(events._global_listeners) == nil)
return true`,
	scoped_mutates_global_admission: `
local scoped<const>, old<const>, keep<const>, added<const> = {}, {}, {}, {}
local calls = ''
local changed = false
events:on({ event = 'phases', emitter = source.id, subscriber = scoped, handler = function()
 calls = calls .. 'S'
 if not changed then
  changed = true
  events:remove_subscriber(old)
  events:on({ event = 'phases', subscriber = added, handler = function() calls = calls .. 'N' end })
 end
end })
events:on({ event = 'phases', subscriber = old, handler = function() error('removed global head ran') end })
events:on({ event = 'phases', subscriber = keep, handler = function() calls = calls .. 'G' end })
port:emit('phases')
assert(calls == 'SG', 'global admission changed after scoped callbacks began')
port:emit('phases')
assert(calls == 'SGSGN')
events:remove_subscriber(scoped)
events:remove_subscriber(keep)
events:remove_subscriber(added)
assert(next(events._subscriptions_by_subscriber) == nil)
assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
return true`,
	retire_and_recreate_during_dispatch: `
local scoped<const>, global<const>, added<const> = {}, {}, {}
local calls = ''
local new_handler<const> = function() calls = calls .. 'N' end
events:on({ event = 'replace', emitter = source.id, subscriber = scoped, once = true, handler = function()
 calls = calls .. 'S'
 events:remove_subscriber(global)
 events:on({ event = 'replace', subscriber = added, handler = new_handler })
 events:on({ event = 'replace', emitter = source.id, subscriber = added, handler = new_handler })
end })
events:on({ event = 'replace', subscriber = global, handler = function() error('removed old global list ran') end })
port:emit('replace')
assert(calls == 'S', 'a recreated scoped/global list leaked into the active emission')
port:emit('replace')
assert(calls == 'SNN', 'replacement list was retired by its old empty predecessor')
events:remove_subscriber(added)
assert(next(events._subscriptions_by_subscriber) == nil)
assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
return true`,
	nil_and_false_errors: `
for index = 1, 2 do
 port:on({ event = 'failure', once = true, handler = function()
  if index == 1 then error(nil) else error(false) end
 end })
 local ok<const>, value<const> = pcall(port.emit, port, 'failure')
 assert(not ok and (index == 1 and value == nil or index == 2 and value == false),
  'nil or false error was confused with successful dispatch')
end
assert(next(events._subscriptions_by_subscriber) == nil)
assert(next(events._scoped_listeners) == nil)
return true`,
} as const;

for (const optLevel of [0, 3] as const) {
	for (const [name, source] of Object.entries(recoveryVectors)) {
		test(`event emission ${name} preserves listener lifecycle (O${optLevel})`, () => {
			const { cpu } = createCartlibProgramHarness(setup + source, { optLevel });
			assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `${name} raised an unhandled assertion`);
		});
	}

	test(`event dispatch can suspend and resume before its handled failure (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local failure<const>, peer<const> = {}, {}
port:on({ event = 'suspend', once = true, handler = function()
 events:remove_subscriber(peer)
 coroutine.yield(failure)
 error(failure)
end })
events:on({ event = 'suspend', subscriber = peer,
 handler = function() error('removed listener ran after resuming') end })
local thread<const> = coroutine.create(function()
 local ok<const>, value<const> = pcall(port.emit, port, 'suspend')
 assert(not ok and value == failure)
end)
local ok<const>, value<const> = coroutine.resume(thread)
assert(ok and value == failure and coroutine.status(thread) == 'suspended')
function resume_emission()
 assert(coroutine.resume(thread))
 assert(coroutine.status(thread) == 'dead')
 assert(next(events._subscriptions_by_subscriber) == nil)
 assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
end
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const snapshot = cpu.captureRuntimeState();
		cpu.restoreRuntimeState(snapshot);
		assert.deepEqual(cpu.captureRuntimeState(), snapshot);
		cpu.collectTrackedHeapBytes();
		const resume = cpu.getGlobalByKey(cpu.stringPool.find('resume_emission')!) as Closure;
		cpu.beginCompletionCall(resume);
		let result = RunResult.Yielded;
		for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant++) {
			result = cpu.runUntilDepth(0, 17);
			assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
		}
		assert.equal(result, RunResult.Halted);
	});

	test(`handled event failures release subscribers and retain no growing listener storage (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(setup + `
weak = setmetatable({}, { __mode = 'v' })
local fail<const> = function(self) error(self.failure) end
function failure_kernel(count)
 for index = 1, count do
  local subscriber<const> = { failure = {} }
  weak[index * 2 - 1], weak[index * 2] = subscriber, subscriber.failure
  events:on({ event = 'failure', subscriber = subscriber, handler = fail, once = true })
  local ok<const>, value<const> = pcall(port.emit, port, 'failure')
  assert(not ok and value == subscriber.failure)
  assert(next(events._subscriptions_by_subscriber) == nil and next(events._global_listeners) == nil)
 end
 return true
end
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('failure_kernel')!) as Closure;
		const weak = cpu.getGlobalByKey(cpu.stringPool.find('weak')!) as Table;
		let first = 0;
		for (let batch = 0; batch < 128; batch++) {
			cpu.beginCompletionCall(kernel, [32]);
			let result = RunResult.Yielded;
			for (let grant = 0; grant < 1000 && result === RunResult.Yielded; grant++) {
				result = cpu.runUntilDepth(0, 1000);
				assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
			}
			assert.equal(result, RunResult.Halted);
			const retained = cpu.collectTrackedHeapBytes();
			for (let index = 1; index <= 64; index++) assert.equal(weak.get(index), null);
			if (batch === 0) first = retained;
			assert.equal(retained, first, 'handled failures grew retained listener storage after warmup');
		}
		t.diagnostic(JSON.stringify({ optLevel, failures: 4096, retained: first }));
	});

	test(`a suspended traversal releases a removed future subscriber and handler (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
weak = setmetatable({}, { __mode = 'v' })
local thread
local tail<const> = {}
local reached_tail = false
local function prepare()
 local removed<const>, captured<const> = {}, {}
 local callback<const> = function(self) assert(self == removed and captured ~= nil); error('removed future listener ran') end
 weak[1], weak[2], weak[3] = removed, callback, captured
 events:on({ event = 'suspend', subscriber = source, once = true, handler = function() coroutine.yield('paused') end })
 events:on({ event = 'suspend', subscriber = removed, handler = callback })
 events:on({ event = 'suspend', subscriber = tail, handler = function() reached_tail = true end })
 thread = coroutine.create(function() port:emit('suspend') end)
 local ok<const>, value<const> = coroutine.resume(thread)
 assert(ok and value == 'paused')
 events:remove_subscriber(removed)
end
prepare()
function finish_traversal()
 assert(coroutine.resume(thread))
 assert(coroutine.status(thread) == 'dead' and reached_tail,
  'retired forward link failed to continue past the removed listener')
 events:remove_subscriber(tail)
 assert(next(events._subscriptions_by_subscriber) == nil and next(events._global_listeners) == nil)
end
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		cpu.collectTrackedHeapBytes();
		const weak = cpu.getGlobalByKey(cpu.stringPool.find('weak')!) as Table;
		for (let index = 1; index <= 3; index++) assert.equal(weak.get(index), null,
			'retired traversal nodes do not own subscribers or handler captures');
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find('finish_traversal')!) as Closure);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
	});

	test(`closing a suspended event dispatch leaves no global retirement state (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local old<const>, peer<const>, later<const> = {}, {}, {}
events:on({ event = 'suspend', subscriber = old, once = true, handler = function()
 events:remove_subscriber(peer)
 coroutine.yield('paused')
 error('closed emission resumed')
end })
events:on({ event = 'suspend', subscriber = peer, handler = function() error('removed peer ran') end })
local thread<const> = coroutine.create(function() port:emit('suspend') end)
local ok<const>, value<const> = coroutine.resume(thread)
assert(ok and value == 'paused')
assert(coroutine.close(thread) and coroutine.status(thread) == 'dead')
assert(next(events._subscriptions_by_subscriber) == nil and next(events._global_listeners) == nil,
 'closed dispatch retained removed listener storage')
local received = 0
local receive<const> = function() received = received + 1 end
for index = 1, 64 do
 events:on({ event = 'later', subscriber = later, handler = receive })
 port:emit('later')
 events:remove_subscriber(later)
end
assert(received == 64 and next(events._subscriptions_by_subscriber) == nil)
assert(next(events._global_listeners) == nil and next(events._scoped_listeners) == nil)
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
	});

	test(`an unhandled listener fault preserves its native reason and handler frame (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
function faulty_handler(self) self.missing_callback() end
port:on({ event = 'fault', handler = faulty_handler })
function emit_fault() port:emit('fault'); error('faulty handler returned normally') end
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find('emit_fault')!) as Closure);
		for (let grant = 0; grant < 10000 && cpu.readExceptionReturnFrameDepth() === -1; grant++) {
			cpu.runUntilDepth(0, 1);
		}
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_CALL_NON_FUNCTION,
			'event dispatch must not catch and rethrow a native fault as an explicit error');
		const handler = cpu.getGlobalByKey(cpu.stringPool.find('faulty_handler')!) as Closure;
		assert.ok(cpu.activeThread.frames.some(frame => frame.functionAddress === handler.functionAddress),
			'original listener frame remains available to the fault debugger');
	});

	test(`warm successful event dispatch makes no heap reservations (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(setup + `
local count = 0
local receive<const> = function() count = count + 1 end
for index = 1, 3 do port:on({ event = 'pulse', handler = receive }) end
for index = 1, 2 do events:on({ event = 'pulse', subscriber = source, handler = receive }) end
function success_kernel(rounds)
 local before<const> = count
 for round = 1, rounds do port:emit('pulse', false) end
 assert(count == before + rounds * 5)
end
return true`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('success_kernel')!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 1024);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});
}
