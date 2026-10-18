local state<const> = require('results')
local result<const>: *bios_string_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		find_plain_fourth_argument = function(t)
			t:wait_until('base String entry complete', function()
				return result.completed == 1
			end, 8)
			local text<const> = 'a.b'
			local literal_first<const>, literal_last<const> = string.find(text, '.', 1, true)
			assert(literal_first == 2 and literal_last == 2)
			local pattern_first<const>, pattern_last<const> = string.find(text, '.', 1, false)
			assert(pattern_first == 1 and pattern_last == 1)
			local method_first<const>, method_last<const> = text:find('.', 1, true)
			assert(method_first == 2 and method_last == 2)
			local find<const> = string.find
			local captured_first<const>, captured_last<const> = find(text, '.', 1, true)
			assert(captured_first == 2 and captured_last == 2)
			assert(select('#', string.find(text, '.', 1, true)) == 2)
		end,
	},
}
