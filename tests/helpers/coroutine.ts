import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { linkTestSystemBlua32 } from './blua32';
import { COROUTINE_FIRMWARE_MODULES } from './firmware_modules';

const testModules = ['context', 'execution'].map(name => ({ path: `testlib/${name}`, source: readFileSync(`testlib/${name}.lua`, 'utf8') }));
const bootSource = `local raise<const> = __bmsx_error
assert = function(value, message) if not value then raise(message) end end
pcall = __bmsx_pcall
xpcall = __bmsx_xpcall
collectgarbage = __bmsx_collect_garbage
type = __bmsx_type
setmetatable = __bmsx_setmetatable
error = raise
next = __bmsx_next`;

export function compileCoroutineTest(body: string, optLevel: 0 | 3) {
	const source = `require('boot')\ncoroutine = require('coroutine')\n${body}`;
	return linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'test').chunk, [
		{ path: 'boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'boot').chunk },
		...COROUTINE_FIRMWARE_MODULES.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk })),
		...testModules.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk })),
	], { entrySource: source, programDomain: 'system', optLevel }));
}

export const coroutineVectors = {
	wrap_close_ownership: `
local wrapped<const> = coroutine.wrap(function() error('original failure') end)
coroutine.close = function() error('replaced public close') end
local ok<const>, message<const> = pcall(wrapped)
assert(not ok and message == 'original failure', message)
return true`,
	halted_tooling_call: `
local rec
rec = function(n)
 if n > 0 then return rec(n - 1) end
 entered = true
 return 1
end
function probe()
 local co = coroutine.create(function() return rec(1) end)
 local ok, value = coroutine.resume(co)
 assert(ok and value == 1)
 return true
end
halt_until_irq
assert(entered)
return true`,
	weak_thread_key_iteration: `
local co = coroutine.create(function() end)
local keep = {}
local t = setmetatable({ [co] = {}, a=keep, b=keep, c=keep, d=keep, e=keep, f=keep, g=keep, h=keep }, { __mode = 'v' })
local before = next(t, co)
collectgarbage()
local after = next(t, co)
assert(before ~= nil and before == after)
return true`,
	test_lifecycle: `
local execution<const> = require('testlib/execution')
local cleaned = false
execution.bind({ kind = 'integration',
 setup = function(t, fixture) fixture.value = 7 end,
 teardown = function(t, fixture) assert(fixture.value == 9); cleaned = true end,
 tests = { named = function(t, fixture)
  t:log('before wait')
  t:wait_ticks(2)
  fixture.value = fixture.value + 2
  error('body failed')
 end }
}, 'named')
assert(execution.resume('setup') == 'returned')
local outcome, operation, value = execution.resume('body')
assert(outcome == 'yielded' and operation == 'log' and value == 'before wait')
local outcome, operation, value = execution.resume('body')
assert(outcome == 'yielded' and operation == 'ticks' and value == 2)
local outcome, thread, message = execution.resume('body')
assert(outcome == 'failed' and message == 'body failed')
assert(execution.resume('teardown') == 'returned' and cleaned)
assert(coroutine.status(thread) == 'dead')
failed_thread = thread
return true`,
	interrupted: `
interrupted = false
local new_target = coroutine.create(function() error('exception entered new coroutine') end)
local suspended_target = coroutine.create(function()
 coroutine.yield(11)
 return 12
end)
local new_wrapped = coroutine.wrap(function() return 42 end)
local suspended_wrapped = coroutine.wrap(function() coroutine.yield(51); return 52 end)
assert(suspended_wrapped() == 51)
local setup_ok, setup_value = coroutine.resume(suspended_target)
assert(setup_ok and setup_value == 11)
function exception()
 assert(not coroutine.isyieldable())
 local ok, message = coroutine.resume(new_target)
 assert(not ok and message == 'cannot resume coroutine across a hardware exception')
 local ok, message = coroutine.resume(suspended_target)
 assert(not ok and message == 'cannot resume coroutine across a hardware exception')
 local wrapped_ok, wrapped_error = pcall(new_wrapped)
 assert(not wrapped_ok and wrapped_error == 'cannot resume coroutine across a hardware exception')
 local wrapped_ok, wrapped_error = pcall(suspended_wrapped)
 assert(not wrapped_ok and wrapped_error == 'cannot resume coroutine across a hardware exception')
 assert(coroutine.status(new_target) == 'suspended')
 assert(coroutine.status(suspended_target) == 'suspended')
 interrupted = true
end
interrupt_ready = true
local co = coroutine.create(function()
  local n = 0
  for i = 1, 40 do n = n + i end
  coroutine.yield(n)
  return n + 1
end)
local ok, value = coroutine.resume(co)
assert(ok and value == 820 and interrupted)
local ok, value = coroutine.resume(co)
assert(ok and value == 821)
local ok, value = coroutine.resume(suspended_target)
assert(ok and value == 12)
assert(coroutine.close(new_target))
assert(new_wrapped() == 42)
assert(suspended_wrapped() == 52)
return true`,
	wide_transfer: `
local co = coroutine.create(function(...) return coroutine.yield(...) end)
local ok, ${Array.from({length: 48}, (_, i) => `v${i}`).join(',')} = coroutine.resume(co, ${Array.from({length: 48}, (_, i) => i).join(',')})
assert(ok and v0 == 0 and v47 == 47)
local ok, ${Array.from({length: 48}, (_, i) => `r${i}`).join(',')} = coroutine.resume(co, ${Array.from({length: 48}, (_, i) => 100 + i).join(',')})
assert(ok and r0 == 100 and r47 == 147)
return true`,
	transfer: `
local main, ismain = coroutine.running()
assert(ismain and type(main) == 'thread' and not coroutine.isyieldable())
local co = coroutine.create(function(a, ...)
  assert(coroutine.isyieldable())
  local self, root = coroutine.running()
  assert(not root and self ~= main and coroutine.status(main) == 'normal')
  local extra = (...)
  local x, y, z = coroutine.yield(a + extra, nil, 'yielded')
  assert(x == 17 and y == nil and z == 23)
  return x + z, nil, extra
end)
assert(coroutine.status(co) == 'suspended')
local ok, a, b, c = coroutine.resume(co, 10, 3)
assert(ok and a == 13 and b == nil and c == 'yielded')
assert(coroutine.status(co) == 'suspended')
local ok, a, b, c = coroutine.resume(co, 17, nil, 23)
assert(ok and a == 40 and b == nil and c == 3)
assert(coroutine.status(co) == 'dead')
assert(not coroutine.resume(co))
assert(coroutine.close(co))
return true`,
	nested: `
local inner = coroutine.create(function() return coroutine.yield(7) end)
local outer = coroutine.create(function()
  local ok, n = coroutine.resume(inner)
  assert(ok and n == 7)
  local value = coroutine.yield(n + 1)
  return coroutine.resume(inner, value)
end)
local ok, value = coroutine.resume(outer)
assert(ok and value == 8)
local ok, innerok, value = coroutine.resume(outer, 99)
assert(ok and innerok and value == 99)
local wrap = coroutine.wrap(function() local v = coroutine.yield(12); return v end)
assert(wrap() == 12 and wrap(34) == 34)
return true`,
	protected_and_failed: `
local failure = {}
local co = coroutine.create(function()
  local ok, value = pcall(function() coroutine.yield('protected'); error(failure) end)
  assert(not ok and value == failure)
  error(failure)
end)
local ok, value = coroutine.resume(co)
assert(ok and value == 'protected')
local ok, value = coroutine.resume(co)
assert(not ok and value == failure and coroutine.status(co) == 'dead')
failed_thread = co
return true`,
	collection: `
local weak = setmetatable({}, {__mode='v'})
local read
local co = coroutine.create(function()
  local state = { value = 10 }
  read = function() return state.value end
  coroutine.yield()
  state.value = 20
end)
weak[1] = co
assert(coroutine.resume(co))
co = nil
collectgarbage()
assert(weak[1] ~= nil and read() == 10)
assert(coroutine.resume(weak[1]))
assert(read() == 20)
read = nil
collectgarbage()
weak_threads = weak
local key = coroutine.create(function() end)
local keys = {[key]=42}
assert(keys[key] == 42 and keys[coroutine.create(function() end)] == nil)
return true`,
	close: `
local read
local co = coroutine.create(function()
  local value = 19
  read = function() return value end
  coroutine.yield()
  value = 20
end)
assert(coroutine.resume(co))
assert(coroutine.close(co))
collectgarbage()
assert(read() == 19)
local failure = {}
local wrapped = coroutine.wrap(function()
 wrapped_failed_thread = coroutine.running()
 local value = 23
 read = function() return value end
 error(failure)
end)
local ok, message = pcall(wrapped)
assert(not ok and message == failure and read() == 23)
assert(coroutine.close(wrapped_failed_thread)) -- wrap already closed the failed state.
return true`,
};
