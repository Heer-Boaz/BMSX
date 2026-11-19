import type { CPU } from '../../machine/ts/machine/cpu/cpu';

/** Exercise the real allocation admission path, including its supplied roots
 * and cycle charge. The disposable test CPU owns this instrumentation. */
export function installAllocationStress(cpu: CPU): { allocations: number } {
	const counter = { allocations: 0 };
	const heap = cpu.luaHeap;
	const reserve = heap.reserve, allocateRecord = heap.allocateRecord, allocateCaptureCells = heap.allocateCaptureCells;
	const forceAssist = () => {
		heap.restoreState({ trackedBytes: heap.usedBytes(), nextCollectionBytes: 0 });
		++counter.allocations;
	};
	heap.reserve = (...args: Parameters<typeof reserve>): void => {
		forceAssist();
		reserve.apply(heap, args);
	};
	heap.allocateRecord = (...args: Parameters<typeof allocateRecord>): number => {
		forceAssist();
		return allocateRecord.apply(heap, args);
	};
	heap.allocateCaptureCells = (...args: Parameters<typeof allocateCaptureCells>): void => {
		forceAssist();
		allocateCaptureCells.apply(heap, args);
	};
	return counter;
}

export const gcStressVectors = {
	stack_relocation_and_control: `
local function deep(n, value)
  local a, b, c, d, e, f = value, value + 1, value + 2, value + 3, value + 4, value + 5
  if n == 0 then return function() return a, f end end
  local result = deep(n - 1, value)
  assert(a + b + c + d + e + f == 6 * value + 15)
  return result
end
for round = 1, 12 do
  local captured = deep(32, round)
  local table = {}
  for i = 1, 48 do table['field:' .. i] = captured end
  local before, capacity = collectgarbage(1)
  assert(before > 0 and capacity > before)
  local ok = pcall(collectgarbage, 1.5)
  assert(not ok)
  assert(not pcall(collectgarbage, 'count'))
  local finished = false
  for i = 1, 256 do if collectgarbage(2) then finished = true break end end
  assert(finished)
  local a, f = table['field:48']()
  assert(a == round and f == round + 5)
  local thread = coroutine.create(function()
    local read = deep(24, round)
    collectgarbage()
    return coroutine.yield(read, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
  end)
  local function received(...)
    local ok, read = ...
    assert(ok and select('#', ...) == 14 and select(14, ...) == 12)
    assert(read() == round)
    return true
  end
  assert(received(coroutine.resume(thread)))
  local ok, returned, read, text = coroutine.resume(thread, table, captured, 'é')
  assert(ok and returned == table and read() == round and text == 'é')
end
return true`,

	incremental_mutations: `
local retained = {}
for i = 1, 384 do retained[i] = { value = { i }, [1] = false } end
local function cell()
  local captured = false
  return function(value) captured = value end, function() return captured end
end
local change, read = cell()
local weak = setmetatable({}, { __mode = 'v' })
for turn = 1, 2 do
  for i = 1, 384 do
    local value = { text = 'live:' .. turn .. ':' .. i }
    local target = retained[i]
    target.value = value
    target[1] = value
    setmetatable(target, { __index = { inherited = value } })
    change(value)
    weak[i] = value
    local pressure = { i, turn }
    assert(target.value == value and target[1] == value)
    assert(target.inherited == value and read() == value and pressure[2] == turn)
  end
end
collectgarbage()
for i = 1, 384 do
  assert(retained[i].value.text == 'live:2:' .. i)
  assert(weak[i] == retained[i].value)
end
return true`,
	growth_and_strings: `
for turn = 1, 72 do
  local t = {}
  for i = 1, 12 do
    t['key:' .. i] = { text = 'é🍻:' .. turn .. ':' .. i }
    t[i] = t['key:' .. i]
  end
  local inherited = setmetatable({}, { __index = t })
  assert(#t == 12 and type(inherited) == 'table')
  for i = 1, 12 do
    assert(inherited['key:' .. i].text == 'é🍻:' .. turn .. ':' .. i)
    assert(t[i] == t['key:' .. i])
    t['key:' .. i] = nil
  end
  assert(t[12].text == 'é🍻:' .. turn .. ':12')
end
return true`,
	captures_and_frames: `
local function pair(value)
  return function(next_value)
    local previous = value
    value = next_value
    local temporary = { previous, value }
    return temporary[1], temporary[2]
  end, function() return value end
end
local function descend(depth, value)
  if depth == 0 then return pair(value) end
  local keep = { value }
  local change, read = descend(depth - 1, keep[1])
  assert(read() == keep[1])
  return change, read
end
for i = 1, 72 do
  local initial = { text = 'initial:' .. i }
  local change, read = descend(12, initial)
  local replacement = { text = 'replacement:' .. i }
  local previous, current = change(replacement)
  assert(previous == initial and current == replacement and read() == replacement)
  local ok, message = pcall(function() error('failure:' .. read().text) end)
  assert(not ok and message == 'failure:replacement:' .. i)
end
return true`,
	coroutine_roots: `
for i = 1, 24 do
  local thread = coroutine.create(function(first)
    local current = { text = first }
    local read = function() return current.text end
    local replacement = coroutine.yield(read)
    current = { text = replacement }
    return read
  end)
  local ok, read = coroutine.resume(thread, 'first:' .. i)
  assert(ok and read() == 'first:' .. i)
  local pressure = { { 'temporary:' .. i }, read }
  assert(pressure[2]() == 'first:' .. i)
  local done, closed = coroutine.resume(thread, 'second:' .. i)
  assert(done and closed == read and closed() == 'second:' .. i)
  assert(coroutine.status(thread) == 'dead')
end
return true`,
	weak_ephemerons: `
local entries = setmetatable({}, { __mode = 'k' })
local weak = setmetatable({}, { __mode = 'v' })
local function chain()
  local keys = {}
  for i = 1, 32 do keys[i] = {} end
  for i = 1, 31 do entries[keys[i]] = { next = keys[i + 1] } end
  entries[keys[32]] = { text = 'reachable:' .. 32 }
  weak[1] = keys[32]
  return keys[1]
end
local worker = coroutine.create(function()
  local head = chain()
  collectgarbage()
  local current = head
  for i = 1, 31 do current = entries[current].next end
  assert(current == weak[1] and entries[current].text == 'reachable:32', 'ephemeron chain lost a live key')
  return true
end)
assert(coroutine.resume(worker))
collectgarbage()
assert(next(entries) == nil and weak[1] == nil, 'ephemeron chain still retained')
weak[2] = 'value-like:' .. 42
collectgarbage()
assert(weak[2] == 'value-like:42')
return true`,
	closure_lifetime: `
local weak = setmetatable({}, { __mode = 'v' })
local worker = coroutine.create(function()
  local function make() return function() return 37 end end
  for i = 1, 72 do
    local first = make()
    local second = make()
    weak[1] = first
    collectgarbage()
    assert(weak[1] == first and first() == 37 and second() == 37, 'live closure lost')
  end
  return true
end)
assert(coroutine.resume(worker))
collectgarbage()
assert(weak[1] == nil, 'dead closure still retained')
return true`,
} as const;
