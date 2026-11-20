import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { linkTestSystemBlua32 } from './blua32';
import { BASE_FIRMWARE_MODULES, COROUTINE_FIRMWARE_MODULES } from './firmware_modules';

/** Actual BIOS pairs/next and collectable keys, shared by both CPU runtimes. */
export function compileTableIterationTest(body: string, optLevel: 0 | 3) {
	const source = `require('base')
require('table_iteration_boot')
coroutine = require('coroutine')
${body}`;
	const modules = [
		{ path: 'table_iteration_boot', source: 'collectgarbage = __bmsx_collect_garbage' },
		...BASE_FIRMWARE_MODULES,
		{ path: 'table', source: readFileSync('machine/bios/table.lua', 'utf8') },
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
		...COROUTINE_FIRMWARE_MODULES,
	];
	return linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'table_iteration').chunk!,
		modules.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path).chunk! })),
		{ entrySource: source, optLevel, programDomain: 'system' }));
}

export const tableIterationVectors = {
	invalid_continuation: `
local function rejects(values, key)
 local ok, message = pcall(next, values, key)
 assert(not ok and message == "invalid key to 'next'")
end
rejects({}, 'missing')
local values<const> = { 11, 22, 33 }
rejects(values, 'missing')
rejects(values, false)
rejects(values, 64)
values[2] = nil
local key, value = next(values, 2)
assert(key == 3 and value == 33, 'a deleted array key remains a continuation')
local flags<const> = { [false] = 41 }
key, value = next(flags)
assert(key == false and value == 41)
assert(next(flags, key) == nil, 'false is a valid continuation, not exhaustion')
return true`,

	bios_unpack_multiple_returns: `
local table<const> = require('table')
local source<const> = {}
for index = 1, 64 do if (index % 7) ~= 0 then source[index] = index end end
for _, count in ipairs({1,7,8,9,14,15,16,31,64}) do
 local values<const> = table.pack(table.unpack(source,1,count))
 assert(values.n == count)
 for index = 1, count do
  if (index % 7) == 0 then assert(values[index] == nil)
  else assert(values[index] == index) end
 end
end
local large<const> = 0x7ffffffe
local edge<const> = {[large]=11,[large+1]=22}
local pair<const> = table.pack(table.unpack(edge,large,large+1))
assert(pair.n==2 and pair[1]==11 and pair[2]==22)
return true`,

	mixed_current_deletion: `
local function capture(value) return function() return value end end
local keys<const> = { false, true, 0, -1, 0.25, 0x80000000, 'field', next }
for index = 1, 16 do
 keys[#keys + 1] = index
 keys[#keys + 1] = 'field_' .. index
 keys[#keys + 1] = {}
 keys[#keys + 1] = capture(index)
 keys[#keys + 1] = coroutine.create(capture(index))
end
local values<const> = {}
for index = 1, #keys do values[keys[index]] = index end
local seen<const> = {}
local count = 0
for key, value in pairs(values) do
 assert(not seen[value], 'traversal returned an entry twice')
 seen[value] = true
 count = count + 1
 values[key] = nil
 assert(rawget(values, key) == nil, 'removed mapping remained visible')
end
assert(count == #keys and next(values) == nil, 'deleting the control key truncated traversal')
return true`,
	other_deletion_and_updates: `
local values<const> = {}
for index = 1, 32 do values['field_' .. index] = index end
local first<const> = next(values)
local removed<const>, removed_value<const> = next(values, first)
assert(removed ~= nil)
local seen<const> = {}
local count = 0
for key, value in pairs(values) do
 if count == 0 then values[removed] = nil end
 assert(key ~= removed and not seen[value])
 seen[value] = true
 values[key] = value + 1000
 count = count + 1
end
assert(count == 31 and not seen[removed_value], 'deleting another field skipped unrelated entries')
for key, value in pairs(values) do assert(value >= 1001 and value <= 1032) end
return true`,
	deleted_keys_and_values_collect: `
local weak<const> = setmetatable({}, { __mode = 'v' })
local values<const> = {}
local function drain()
 for index = 1, 24 do
  local key<const> = index % 3 == 0 and coroutine.create(function() end)
   or index % 3 == 1 and {} or (function(value) return function() return value end end)(index)
  local value<const> = { index = index, payload = {} }
  values[key] = value
  weak[index] = key
  weak[index + 24] = value
 end
 local count = 0
 for key, value in pairs(values) do
  values[key] = nil
  collectgarbage()
  assert(rawget(values, key) == nil and value.index >= 1)
  count = count + 1
 end
 assert(count == 24 and next(values) == nil)
end
drain()
collectgarbage()
for index = 1, 48 do assert(weak[index] == nil, 'deleted entry retained a collectable key or value') end
return true`,
	allocation_collection_during_deletion: `
local function sentinel() return setmetatable({ {} }, { __mode = 'v' }) end
local weak<const> = sentinel()
local values<const> = {}
for index = 1, 24 do values[{}] = index end
local suffix<const> = '${'x'.repeat(2048)}'
local count = 0
for key, value in pairs(values) do
 values[key] = nil
 for index = 1, 32 do
  local garbage<const> = (value * 64 + index) .. suffix
  assert(#garbage > 2048)
 end
 assert(rawget(values, key) == nil)
 count = count + 1
end
assert(count == 24 and next(values) == nil)
assert(weak[1] == nil, 'the fixture did not reach allocation-triggered collection')
return true`,
	checkpoint_after_delete: `
checkpoint_table = {}
for index = 1, 24 do checkpoint_table[{}] = index end
local count = 0
for key, value in pairs(checkpoint_table) do
 checkpoint_table[key] = nil
 checkpoint_key = key
 if count == 0 then halt_until_irq end
 checkpoint_key = nil
 count = count + 1
end
assert(count == 24 and next(checkpoint_table) == nil)
return true`,
	collected_string_key_reuse: `
local values<const> = {}
local function drain(round)
 for index = 1, 32 do
  local serial<const> = round * 64 + index
  values['runtime-key:' .. serial] = 'runtime-value:' .. serial
 end
 local count = 0
 for key, value in pairs(values) do
  values[key] = nil
  collectgarbage()
  assert(rawget(values, key) == nil and #value > 0,
   'a live deleted-key continuation lost its string or revived a mapping')
  count = count + 1
 end
 assert(next(values) == nil)
 return count
end
for round = 1, 4 do
 assert(drain(round) == 32, 'recycled string-key slots truncated a later traversal')
 collectgarbage()
end
return true`,
	delete_reinsert_churn: `
local values<const>, keys<const>, padding<const> = {}, {}, {}
-- A stride of 32 object identities puts all keys in the same hash bucket.
for index = 1, 32 do
 keys[index] = {}
 for collision = 1, 31 do padding[collision] = {} end
 values[keys[index]] = index
end
assert(#padding == 31)
churn_keys, churn_values = keys, values
churn_kernel = function(rounds)
 for round = 1, rounds do
  local count = 0
  for key, value in pairs(values) do
   assert(value >= 1 and value <= 32)
   values[key] = nil
   count = count + 1
  end
  assert(count == 32 and next(values) == nil)
  for index = 1, 32 do values[keys[index]] = index end
  for index = 1, 32 do assert(values[keys[index]] == index) end
 end
end
churn_kernel(16)
return true`,
} as const;
