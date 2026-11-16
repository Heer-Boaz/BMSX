import type { CPU } from '../../machine/ts/machine/cpu/cpu';

/** Exercise the real allocation admission path, including its supplied roots
 * and cycle charge. The disposable test CPU owns this instrumentation. */
export function installAllocationStress(cpu: CPU): { allocations: number } {
	const counter = { allocations: 0 };
	const heap = cpu.luaHeap;
	const reserve = heap.reserve;
	heap.reserve = (...args: Parameters<typeof reserve>): void => {
		heap.restoreState({ trackedBytes: heap.usedBytes(), nextCollectionBytes: 0 });
		++counter.allocations;
		reserve.apply(heap, args);
	};
	return counter;
}

export const gcStressVectors = {
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
