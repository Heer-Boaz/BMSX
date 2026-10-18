module<entry>

local state<const> = require('results')
local result<const>: *bios_pattern_manual_result = state.result

-- The fourth argument chooses a literal dot instead of the any-codepoint atom.
result.plain_start, result.plain_end = string.find('a.b', '.', 1, true)
result.pattern_start, result.pattern_end = string.find('a.b', '.', 1, false)
result.negative_start = string.find('abcabc', 'a', -3, true)
local unicode<const> = string.char(233) .. '.' .. string.char(128640)
result.unicode_start, result.unicode_end =
	string.find(unicode, string.char(128640), 1, true)
print('Pattern positions', result.plain_start, result.plain_end,
	result.pattern_start, result.pattern_end,
	result.negative_start, result.unicode_start, result.unicode_end)

-- %w includes underscore. Captures return text; () instead records a position.
local name<const>, x_text<const>, y_text<const> =
	string.match('ship_17 x=12 y=-3', '^(%w+)%s+x=(%-?%d+)%s+y=(%-?%d+)$')
result.capture_match = name == 'ship_17' and 1 or 0
result.coordinate_match = tonumber(x_text) == 12 and tonumber(y_text) == -3
	and 1 or 0
local digits
result.position_capture, digits = string.match('tag=42', '()(%d+)')
result.position_text_match = digits == '42' and 1 or 0
-- find rejects source-length+1 before matching; match can try that position.
result.empty_find_nil = string.find('abc', '', 4) == nil and 1 or 0
result.empty_match_length = #string.match('abc', '', 4)
print('Pattern captures', name, x_text, y_text, result.position_capture, digits)
print('Pattern end search', result.empty_find_nil, result.empty_match_length)

-- The iterator can be used directly by an ordinary generic for loop.
local word_count = 0
for word in string.gmatch('cat dog ship_17', '%w+') do
	result.word_heads[word_count] = string.byte(word)
	word_count = word_count + 1
end
result.word_count = word_count
local anchored_count = 0
for item in string.gmatch('abc', '^.') do
	anchored_count = anchored_count + 1
end
result.anchored_count = anchored_count
print('Pattern iteration', word_count, result.word_heads[0],
	result.word_heads[1], result.word_heads[2], anchored_count)

local greedy<const> = string.match('a1b2b', 'a.*b')
local minimal<const> = string.match('a1b2b', 'a.-b')
local balanced<const> = string.match('x(a(b)c)y', '%b()')
local frontier<const> = string.match('cat scatter', '%f[%w]cat%f[%W]')
local backreference<const> = string.match('go go stop', '(%w+)%s+%1')
result.greedy_match = greedy == 'a1b2b' and 1 or 0
result.minimal_match = minimal == 'a1b' and 1 or 0
result.balanced_match = balanced == '(a(b)c)' and 1 or 0
result.frontier_match = frontier == 'cat' and 1 or 0
result.backreference_match = backreference == 'go' and 1 or 0
result.complement_match = string.match('qZ', '%Q') == 'Z' and 1 or 0
print('Pattern atoms', greedy, minimal, balanced, frontier, backreference,
	result.complement_match)

local substituted<const>, substitutions<const> =
	string.gsub('red blue', '(%a+)', '[%1]')
result.string_replacement_match = substituted == '[red] [blue]' and 1 or 0
result.string_replacement_count = substitutions
-- Table false becomes text; a missing table value preserves the original.
local mapped<const>, mapped_count<const> =
	string.gsub('red blue', '(%a+)', { red = false })
result.table_replacement_match = mapped == 'false blue' and 1 or 0
result.table_replacement_count = mapped_count
print('Pattern replacement text', substituted, substitutions, mapped,
	mapped_count)

-- Callback false preserves the match; only its first returned value is used.
local callback_calls = 0
local changed<const>, changed_count<const> =
	string.gsub('red blue', '(%a+)', function(word)
		callback_calls = callback_calls + 1
		if word == 'red' then
			return false
		end
		return 'B', 'ignored'
	end)
result.callback_replacement_match = changed == 'red B' and 1 or 0
result.callback_replacement_count = changed_count
result.callback_calls = callback_calls
-- Empty matches advance past source codepoints without copying them.
local empty_changed<const>, empty_count<const> = string.gsub('abc', '', '_')
result.empty_substitution_match = empty_changed == '____' and 1 or 0
result.empty_substitution_count = empty_count
print('Pattern replacement callback', changed, changed_count, callback_calls)
print('Pattern replacement empty', empty_changed, empty_count)

-- Unreached pattern/replacement errors are not prevalidated.
local limited<const>, limited_count<const> = string.gsub('x', '[', false, 0)
result.zero_limit_match = limited == 'x' and 1 or 0
result.zero_limit_count = limited_count
local unchanged<const>, unchanged_count<const> = string.gsub('x', 'z', false)
result.deferred_replacement_match = unchanged == 'x' and 1 or 0
result.deferred_replacement_count = unchanged_count
local pattern_ok<const>, pattern_error<const> = pcall(string.match, 'x', '[')
local capture_ok<const>, capture_error<const> = pcall(string.match, 'x', '%1')
local replacement_ok<const>, replacement_error<const> =
	pcall(string.gsub, 'x', 'x', false)
result.invalid_pattern_error = not pattern_ok
	and pattern_error == 'invalid string pattern' and 1 or 0
result.invalid_capture_error = not capture_ok
	and capture_error == 'invalid string pattern capture' and 1 or 0
result.invalid_replacement_error = not replacement_ok
	and replacement_error ==
		'string.gsub replacement must be a string, number, function, or table.'
	and 1 or 0
print('Pattern deferred errors', limited, limited_count, unchanged,
	unchanged_count)
print('Pattern syntax error', pattern_ok, pattern_error)
print('Pattern capture error', capture_ok, capture_error)
print('Pattern replacement error', replacement_ok)
print(replacement_error)

result.completed = 1
while true do
	halt_until_irq
end
