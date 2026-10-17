module<entry>

local state<const> = require('results')
local result<const>: *bios_base_manual_result = state.result

-- Zero is true; a successful assertion preserves its whole argument tuple.
local label, gap
result.assert_first, label, gap, result.assert_last = assert(0, 'kept', nil, 7)
result.assert_hole = gap == nil and 1 or 0
result.assert_count = select('#', assert(0, 'kept', nil, 7))
print('Assert values', result.assert_first, label, gap, result.assert_last)
local nil_ok<const>, nil_error<const> = pcall(assert, false, nil)
result.assert_nil_error = not nil_ok and nil_error == nil and 1 or 0
print('Assert nil error', nil_ok, nil_error)
local default_ok<const>, default_error<const> = pcall(assert, false)
result.assert_default_error = not default_ok
	and default_error == 'assertion failed!' and 1 or 0
print('Assert default', default_ok, default_error)

-- Read numeric text through the installed converter, not a cartridge parser.
result.conversions[0] = tonumber(12.5)
result.conversions[1] = tonumber('  -12.5e1  ')
result.conversions[2] = tonumber('.25')
result.conversions[3] = tonumber('0x10')
result.conversions[4] = tonumber('-101', 2)
result.conversions[5] = tonumber('z', 36)
local rejected<const> = tonumber('12x')
result.conversion_rejected = rejected == nil and 1 or 0
print('Conversions', result.conversions[0], result.conversions[1], result.conversions[2],
	result.conversions[3], result.conversions[4], result.conversions[5], rejected)
local base_ok<const>, base_error<const> = pcall(tonumber, '10', 37)
result.conversion_bad_base = not base_ok
	and base_error == 'bad argument #2 to tonumber (base out of range)' and 1 or 0
print('Invalid base', base_ok, base_error)

local shared<const> = { count = 3 }
local other<const> = { count = 3 }
local thread<const> = coroutine.running()
local names<const> = type(nil) .. '/' .. type(false) .. '/' .. type(12) .. '/'
	.. type('text') .. '/' .. type(shared) .. '/' .. type(assert) .. '/' .. type(thread)
result.type_names_match =
	names == 'nil/boolean/number/string/table/function/thread' and 1 or 0
print('Type names', names)
local labels<const> = tostring(shared) .. '/' .. tostring(assert) .. '/' .. tostring(thread)
result.object_labels_match = labels == 'table/function/thread' and 1 or 0
print('Object labels', labels)
result.identity_same = rawequal(shared, shared) and 1 or 0
result.identity_distinct = not rawequal(shared, other) and 1 or 0
print('Identity', rawequal(shared, shared), rawequal(shared, other))

-- A singleton makes next's first pair unambiguous without ordering a hash table.
local singleton<const> = { [4] = 41 }
result.next_key, result.next_value = next(singleton)
result.next_done_count = select('#', next(singleton, result.next_key))
result.next_done_nil = next(singleton, result.next_key) == nil and 1 or 0
print('Next', result.next_key, result.next_value, result.next_done_count)
local inventory<const> = { apples = 11, pears = 22, plums = 33 }
for _key, quantity in pairs(inventory) do
	result.pairs_count = result.pairs_count + 1
	result.pairs_sum = result.pairs_sum + quantity
end
print('Inventory', result.pairs_count, result.pairs_sum)
local sequence<const> = { 10, 20, nil, 90 }
for _index, quantity in ipairs(sequence) do
	result.ipairs_count = result.ipairs_count + 1
	result.ipairs_sum = result.ipairs_sum + quantity
end
result.ipairs_after_hole = sequence[4]
print('Sequence prefix', result.ipairs_count, result.ipairs_sum, result.ipairs_after_hole)

-- Count the tuple, not table entries: nil is a position, not an end marker.
result.select_count = select('#', 'skip', nil, 9)
local suffix_first<const>, suffix_last<const> = select(2, 'skip', nil, 9)
result.select_first_nil = suffix_first == nil and 1 or 0
result.select_last = suffix_last
result.select_suffix_count = select('#', select(2, 'skip', nil, 9))
result.select_empty_count = select('#', select(4, 'skip', nil, 9))
print('Select suffix', suffix_first, suffix_last)
print('Tuple counts', result.assert_count, result.select_count,
	result.select_suffix_count, result.select_empty_count)

-- This cartridge owns this one global; protection is not a transaction.
setglobal('bios_base_manual_counter', 11)
result.global_values[0] = bios_base_manual_counter
local changed_ok<const>, changed_error<const> = pcall(function()
	bios_base_manual_counter = 22
	error('counter changed')
end)
result.global_values[1] = getglobal('bios_base_manual_counter')
result.global_error = not changed_ok and changed_error == 'counter changed' and 1 or 0
print('Global writes', result.global_values[0], result.global_values[1],
	changed_ok, changed_error)
setglobal('bios_base_manual_counter', nil)
result.global_cleared = getglobal('bios_base_manual_counter') == nil and 1 or 0
print('Global cleared', getglobal('bios_base_manual_counter'))

-- print separates arguments with tabs, including nil; its fallthrough returns one nil.
result.print_count = select('#', print('Print tuple', nil, 7))
print('Print result count', result.print_count)
result.completed = 1
while true do
	halt_until_irq
end
