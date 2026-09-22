import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { linkTestSystemBlua32 } from './blua32';

const coroutineSource = readFileSync('machine/bios/coroutine.lua', 'utf8');
const bootSource = `local raise<const> = __bmsx_error
assert = function(value, message) if not value then raise(message) end end
pcall = __bmsx_pcall
xpcall = __bmsx_xpcall
collectgarbage = __bmsx_collect_garbage
type = __bmsx_type
setmetatable = __bmsx_setmetatable
error = raise`;

export function compileCoroutineTest(body: string, optLevel: 0 | 3) {
	const source = `require('boot')\nlocal coroutine<const> = require('coroutine')\n${body}`;
	return linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'test').chunk, [
		{ path: 'boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'boot').chunk },
		{ path: 'coroutine', source: coroutineSource, chunk: parseLuaChunk(coroutineSource, 'coroutine').chunk },
	], { entrySource: source, programDomain: 'system', optLevel }));
}

export const coroutineVectors = {
	interrupted: `
interrupted = false
function exception() interrupted = true end
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
return true`,
};
