import { readFileSync, readdirSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import { linkTestSystemBlua32 } from './blua32';

/** Actual firmware compiler/REPL and the production packed diagnostic directory. */
export function compileFrameEvaluationTest(body: string, optLevel: 0 | 3, includeDiagnostics = true) {
	const modules = [
		...['base', 'table', 'coroutine', 'string/base', 'string/utf8', 'string/pattern', 'debug/scopes', 'debug/frame', 'shell/repl'],
		...readdirSync('machine/bios/compiler').filter(name => name.endsWith('.lua')).sort().map(name => `compiler/${name.slice(0, -4)}`),
	].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }));
	modules.push({ path: 'bmsx/blua32', source: BLUA32_FIRMWARE_MODULE_SOURCE },
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
		{ path: 'frame_test/primitives', source: `frame_count = __bmsx_frame_count
running_thread = __bmsx_coroutine_running
collectgarbage = __bmsx_collect_garbage` });
	const source = `require('base')
table = require('table')
string = require('string/base')
string.find = require('string/pattern').find
coroutine = require('coroutine')
lua_compiler = require('compiler/api')
load = lua_compiler.load
repl = require('shell/repl')
frame_bindings = require('debug/frame')
require('frame_test/primitives')
escaped = false
optimization_level = ${optLevel}
return pcall(function()
${body}
end)`;
	return linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'frame_test').chunk!,
		modules.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk! })),
		{ entrySource: source, optLevel, programDomain: 'system' }),
		includeDiagnostics ? new Map([{ path: 'frame_test', source }, ...modules].map(module => [module.path, { displayPath: `${module.path}.lua`, source: module.source }])) : null);
}

export const frameEvaluationCases = {
	static_storage_identity: `
bss buffered: word
data writable: word = 11
rodata frozen: word = 17
local nested = function(...)
 bss buffered: word
 data writable: word = 22
 rodata frozen: word = 23
 *buffered = *buffered + 1
 return { buffered = buffered, writable = writable, frozen = frozen }
end
local exercise = function(...)
 local index<const> = frame_count(running_thread()) - 1
 local names<const> = frame_bindings.resolve(index, 0)
 local ok, cells = repl.evaluate('return nested()', '=static-identity', 'frame', index, names)
 assert(ok and cells.buffered ~= buffered and cells.writable ~= writable and cells.frozen ~= frozen)
 assert(mem[cells.buffered] == 1 and mem[cells.writable] == 22 and mem[cells.frozen] == 23)
 assert(*buffered == 40 and *writable == 11 and *frozen == 17)
 local again = nested()
 assert(again.buffered == cells.buffered and again.writable == cells.writable and again.frozen == cells.frozen)
 assert(mem[cells.buffered] == 2)
 return true
end
*buffered = 40
return exercise()`,
	call_results: `
local exercise = function(tuple, spread, receiver, wide, ...)
 local index<const> = frame_count(running_thread()) - 1
 local names<const> = frame_bindings.resolve(index, 0)
 local verify<const> = function(source, ...)
  local values<const> = table.pack(repl.evaluate(source, '=frame-results', 'frame', index, names))
  assert(values[1] == true, source)
  assert(values.n == select('#', ...) + 1, source)
  for i = 2, values.n do assert(values[i] == select(i - 1, ...), source) end
 end
 verify('return tuple()', 7, nil, false, 9, nil)
 verify('return 99, spread(1, tuple())', 99, 1, 7, nil, false, 9, nil)
 verify('return (tuple())', 7)
 verify('return (tuple)()', 7, nil, false, 9, nil)
 verify('return spread(tuple(), 2)', 7, 2)
 verify('return spread(1, (tuple()))', 1, 7)
 verify('return receiver:spread(1, tuple())', 40, 1, 7, nil, false, 9, nil)
 verify('return select(2, 7)')
 verify('return 1, select(2, 7)', 1)
 verify('return spread(1, select(2, 7))', 1)
 verify('return (select(2, 7))', nil)
 verify('return pcall(tuple)', true, 7, nil, false, 9, nil)
 local values<const> = table.pack(repl.evaluate('return 999, wide()', '=wide-results', 'frame', index, names))
 assert(values.n == 262 and values[1] == true and values[2] == 999)
 for i = 0, 259 do assert(values[i + 3] == i) end
 assert(tuple() == 7 and spread(true) == true and receiver.value == 40 and wide() == 0)
 return true
end
return exercise(
 function(...) return 7, nil, false, 9, nil end,
 function(...) return ... end,
 { value = 40, spread = function(self, ...) return self.value, ... end },
 function(...) return ${Array.from({ length: 260 }, (_, index) => index).join(',')} end)`,
	lexical_names: `
setglobal('folded', 999)
setglobal('unreferenced', 999)
local make = function(seed, ...)
 local folded<const> = 17
 local unreferenced = seed + 1
 local captured = seed
 return function(value, ...)
  local index<const> = frame_count(running_thread()) - 1
  local names = frame_bindings.resolve(index, 0)
  assert(names.folded ~= nil and names.folded.is_const and not names.folded.available)
  assert(names.unreferenced ~= nil and not names.unreferenced.is_const and not names.unreferenced.available)
  assert(names.seed ~= nil and not names.seed.available)
  assert(names.captured.available and names.captured.upvalue)
  local ok, message = repl.evaluate('return folded', '=uncaptured-const', 'frame', index, names)
  assert(not ok and string.find(message, 'no live location') ~= nil)
  ok, message = repl.evaluate('unreferenced = 123', '=uncaptured-write', 'frame', index, names)
  assert(not ok and string.find(message, 'no live location') ~= nil)
  assert(getglobal('folded') == 999 and getglobal('unreferenced') == 999)
  local ok, result = repl.evaluate('local folded = 2; return folded + captured + value', '=new-local', 'frame', index, names)
  assert(ok and result == 45 and captured == 40 and value == 3)
  return true
 end
end
local callback<const> = make(40)
return callback(3)`,
	named_scopes: `
local make = function(seed)
 local captured = seed
 local exercise = function(value, ...)
  local object<const> = { answer = 10 }
  local shadow = { answer = 20 }
  local folded = 17
  local index<const> = frame_count(running_thread()) - 1
  do
   local shadow = 9
   local names, label = frame_bindings.resolve(index, 0)
   assert(names ~= nil and label == 'exercise')
   assert(names.value.available and not names.value.upvalue and not names.value.is_const)
   assert(names.captured.available and names.captured.upvalue)
   assert(names.object.available and names.object.is_const)
   assert(names.shadow ~= nil and names.shadow.available == (optimization_level == 0))
   assert(names.folded ~= nil and names.folded.available == (optimization_level == 0))
   local ok, a, b = repl.evaluate('value = value + 2; captured = captured + 3; object.answer = value; return value, captured', '=named-frame', 'frame', index, names)
   assert(ok and a == 42 and b == 13 and value == 42 and captured == 13 and object.answer == 42)
   ok, a = repl.evaluate('object = false', '=named-const', 'frame', index, names)
   assert(not ok and string.find(a, 'cannot assign to const local') ~= nil)
   setglobal('shadow', 999)
   ok, a = repl.evaluate('return shadow', '=named-shadow', 'frame', index, names)
   if optimization_level == 0 then assert(ok and a == 9)
   else assert(not ok and string.find(a, 'no live location') ~= nil) end
   assert(shadow == 9)
   local absent, message = frame_bindings.resolve(index, 999)
   assert(absent == nil and string.find(message, 'inline depth') ~= nil)
  end
  assert(shadow.answer == 20 and folded == 17)
  local names = frame_bindings.resolve(index, 0)
  assert(names.shadow.available)
  local ok, result = repl.evaluate('return shadow.answer', '=outer-shadow', 'frame', index, names)
  assert(ok and result == 20)
  return shadow.answer == 20
 end
 return exercise
end
assert(make(10)(40))
function verify_ram_frame(index)
 local missing, message = frame_bindings.resolve(index, 0)
 assert(missing == nil and message == 'Frame function has no installed symbols.')
end
local ram<const> = assert(load('verify_ram_frame(frame_count(running_thread()) - 1); return true'))
assert(ram())
return true`,
	named_inline: `
local run = function(seed, ...)
 local captured = { answer = seed }
 local inspect<const> = function(value)
  local thread<const> = running_thread()
  local names, label = frame_bindings.resolve(frame_count(thread) - 1, optimization_level == 3 and 1 or 0)
  return names, label, captured.answer + value
 end
 local names, label, total = inspect(2)
 assert(label == 'inspect' and total == 42)
 assert(names.captured.available and names.value.available == (optimization_level == 0))
 assert(names.captured.upvalue == (optimization_level == 0))
 assert(names.seed ~= nil and not names.seed.available)
 assert(names.inspect ~= nil and not names.inspect.available, 'const function declarations are recursive in BLua')
 assert(names.total == nil and names.names == nil, 'later caller locals are outside the definition scope')
 local names, label, total = inspect(3)
 assert(label == 'inspect' and total == 43 and names.value.available == (optimization_level == 0))
 return true
end
return run(40)`,
	bindings: `
local make = function(seed, open)
 local captured = seed
 local exercise = function(value, object, ...)
  local index<const> = frame_count(running_thread()) - 1
  local names<const> = {
   value = { index = 0, upvalue = false, available = true, is_const = false },
   object = { index = 1, upvalue = false, available = true, is_const = true },
   captured = { index = 0, upvalue = true, available = true, is_const = false },
   unavailable = { index = 9999, upvalue = false, available = false, is_const = false },
  }
  local ok, a, b, c, d, e = repl.evaluate(
   'value = value + 2; captured = captured + 3; object.answer = value; return value, nil, false, captured, object',
   '=frame', 'frame', index, names)
  assert(ok and a == 42 and b == nil and c == false and d == 13 and e == object)
  assert(value == 42 and captured == 13 and object.answer == 42)
  local ok, a = repl.evaluate('captured = object; return captured', '=frame', 'frame', index, names)
  assert(ok and a == object and captured == object)
  local ok, a = repl.evaluate('captured = false; return captured', '=frame', 'frame', index, names)
  assert(ok and a == false and captured == false)
  local ok, a = repl.evaluate('captured = nil; return captured', '=frame', 'frame', index, names)
  assert(ok and a == nil and captured == nil)
  local ok, message = repl.evaluate('value = 43; error("retained frame write")', '=frame', 'frame', index, names)
  assert(not ok and message == 'retained frame write' and value == 43)
  ok, message = repl.evaluate('value = 999; object = nil', '=frame', 'frame', index, names)
  assert(not ok and string.find(message, 'cannot assign to const local') ~= nil and value == 43)
  unavailable = 100
  ok, message = repl.evaluate('value = 999; return unavailable', '=frame', 'frame', index, names)
  assert(not ok and string.find(message, 'no live location') ~= nil and value == 43)
  ok, message = repl.evaluate('return function() return unavailable end', '=frame', 'frame', index, names)
  assert(not ok and string.find(message, 'no live location') ~= nil)
  local ok, copied = repl.evaluate('local value = value + 1; return function() return value end', '=frame', 'frame', index, names)
  assert(ok and copied() == 44 and value == 43)
  local ok, a = repl.evaluate('local inner = function(n) value = value + n; return value end; escaped = inner; return inner(2)', '=frame', 'frame', index, names)
  assert(ok and a == 45 and value == 45)
  ok, message = pcall(escaped, 1)
  assert(not ok and message == 'Selected frame evaluation has ended.' and value == 45)
  local ok, a, b = repl.evaluate('value = false; return value, object', '=frame', 'frame', index, names)
  assert(ok and a == false and b == object)
  local ok, a, b = repl.evaluate('value = nil; return value, false', '=frame', 'frame', index, names)
  assert(ok and a == nil and b == false and value == nil)
  assert(repl.evaluate('value = 50', '=frame', 'frame', index, names))
  local ok, a = repl.evaluate('local value = 7; local fn = function(value) return value + 1 end; return fn(value)', '=frame', 'frame', index, names)
  assert(ok and a == 8 and value == 50)
  local ok, a = repl.evaluate('return load("return unavailable")()', '=frame', 'frame', index, names)
  assert(ok and a == 100, 'nested load uses ordinary globals, not the external lexical scope')
  return copied
 end
 if open then return exercise(40, {}) end
 return exercise
end
local reader = make(10, true)
assert(reader() == 44)
reader = make(10, false)(40, {})
assert(reader() == 44)
return true`,
	coroutine: `
local co = coroutine.create(function(value)
 local index<const> = frame_count(running_thread()) - 1
 local names<const> = { value = { index = 0, upvalue = false, available = true, is_const = false } }
 local ok, result = repl.evaluate('value = value + 1; coroutine.yield(value); value = value + 1; return value', '=thread-frame', 'frame', index, names)
 assert(ok and result == 12 and value == 12)
 return value
end)
local ok, value = coroutine.resume(co, 10)
assert(ok and value == 11)
collectgarbage()
halt_until_irq
ok, value = coroutine.resume(co)
assert(ok and value == 12)
return true`,
	lexical_symbols: `
local exercise = function(value, ...)
 local index<const> = frame_count(running_thread()) - 1
 local names<const> = { value = { index = 0, upvalue = false, available = true, is_const = false } }
 local scope<const> = frame_bindings.open(index, names)
 local f<const> = lua_compiler.syntax_factory
 local source<const> = f.chunk(f.block({ f.return_statement({ f.identifier('value') }) }))
 assert(lua_compiler.compile_syntax(source, '=frame-syntax', nil, scope)() == 17)
 local env<const> = { value = 900, other = 12 }
 assert(load('return value + other', '=frame-environment', 't', env, scope)() == 29)
 assert(env.value == 900 and value == 17)
 local symbol<const> = f.generated_symbol('value')
 local missing<const> = f.chunk(f.block({ f.return_statement({ f.reference(symbol) }) }))
 local ok, message = pcall(lua_compiler.compile_syntax, missing, '=missing-lexical', nil, scope)
 assert(not ok and string.find(message, 'unknown local or function parameter') ~= nil)
 scope.close()
 return true
end
return exercise(17)`,
	collection: `
local weak<const> = setmetatable({}, { __mode = 'v' })
local create = function(...)
 local co<const> = coroutine.create(function(value)
  local index<const> = frame_count(running_thread()) - 1
  local names<const> = { value = { index = 0, upvalue = false, available = true, is_const = false } }
  local ok, reader = repl.evaluate('return function() return value end', '=frame-release', 'frame', index, names)
  assert(ok and value == 17)
  escaped = reader
 end)
 weak[1] = co
 assert(coroutine.resume(co, 17))
end
create()
collectgarbage()
assert(weak[1] == nil, 'an escaped accessor must not retain the completed thread')
local ok, message = pcall(escaped)
assert(not ok and message == 'Selected frame evaluation has ended.')
return true`,
	public_names: `
local exercise = function(value, ...)
 local index<const> = frame_count(running_thread()) - 1
 local names<const> = { value = { index = 0, upvalue = false, available = true, is_const = false } }
 local loader<const>, protected<const> = lua_compiler.load, pcall
 lua_compiler.load = false
 pcall = false
 local ok, result = repl.evaluate('value = value + 1; return value', '=private-loader', 'frame', index, names)
 assert(ok and result == 18 and value == 18)
 local ok, message = repl.evaluate('escaped = function() return value end; value = value + 1; error("private protection")', '=private-protection', 'frame', index, names)
 assert(not ok and message == 'private protection' and value == 19)
 ok, message = protected(escaped)
 assert(not ok and message == 'Selected frame evaluation has ended.')
 lua_compiler.load = loader
 pcall = protected
 return true
end
return exercise(17)`,
} as const;
