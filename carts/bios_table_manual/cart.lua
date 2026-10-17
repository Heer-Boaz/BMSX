module<entry>

local state<const> = require('results')
local result<const>: *bios_table_manual_result = state.result

-- The explicit count preserves nil positions, including the trailing nil.
local packed<const> = table.pack(10, nil, 30, nil)
result.packed_count = packed.n
local gap, tail
result.tuple_first, gap, result.tuple_third, tail =
	table.unpack(packed, 1, packed.n)
result.tuple_holes = gap == nil and tail == nil and 1 or 0
result.tuple_count = select('#', table.unpack(packed, 1, packed.n))
print('Packed tuple', result.tuple_first, gap, result.tuple_third, tail)
print('Tuple counts', result.packed_count, result.tuple_count)
local packed_text<const> = table.concat(packed, '|', 1, packed.n)
result.packed_text_match = packed_text == '10||30|' and 1 or 0
print('Packed concat', packed_text)

-- Ordinary sequence operations use the Table's maintained length.
local sequence<const> = { 9, 3, 7 }
result.insert_count = select('#', table.insert(sequence, 2, 5.5))
result.removed = table.remove(sequence, 3)
table.insert(sequence, 8)
result.sequence_length = #sequence
result.sort_count = select('#', table.sort(sequence))
result.ascending[0], result.ascending[1],
	result.ascending[2], result.ascending[3] = table.unpack(sequence)
result.default_unpack_count = select('#', table.unpack(sequence))
print('Mutation', result.insert_count, result.removed, result.sequence_length)
print('Ascending', result.sort_count, table.concat(sequence, ','))
print('Default unpack', table.unpack(sequence))
print('Default unpack count', result.default_unpack_count)

local negative_text<const> = table.concat(sequence, ':', -3, -1)
local zero_text<const> = table.concat(sequence, ':', 0, 0)
local empty_text<const> = table.concat(sequence, ':', 3, 2)
result.negative_text_match = negative_text == '7:8:9' and 1 or 0
result.zero_text_match = zero_text == '5.5:7:8:9' and 1 or 0
result.empty_concat_length = #empty_text
result.empty_unpack_count = select('#', table.unpack(sequence, 3, 2))
print('Negative range', negative_text)
print('Zero range', zero_text)
print('Empty ranges', empty_text, result.empty_unpack_count)

-- A comparator orders these same Numbers in descending order.
table.sort(sequence, function(left, right) return left > right end)
result.descending[0], result.descending[1],
	result.descending[2], result.descending[3] = table.unpack(sequence)
print('Descending', table.concat(sequence, ','))
result.last_removed = table.remove(sequence)
result.remaining_length = #sequence
print('Removed last', result.last_removed, result.remaining_length)

-- Protection catches the error value; it does not undo earlier swaps.
local partial<const> = { 3, 1, 2 }
local failure<const> = { code = 72 }
local ok<const>, caught<const> = pcall(table.sort, partial,
	function(left, right)
		result.comparison_count = result.comparison_count + 1
		if result.comparison_count < 5 then
			return left < right
		end
		error(failure)
	end)
result.failure_identity = not ok and caught == failure and 1 or 0
result.partial[0], result.partial[1], result.partial[2] = table.unpack(partial)
print('Comparator failure', ok, caught == failure, result.comparison_count)
print('Partial sequence', table.concat(partial, ','))
result.completed = 1
while true do
	halt_until_irq
end
