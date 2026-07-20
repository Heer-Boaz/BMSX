__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	local wrap<const> = require('bios/util/wrap_text_lines').wrap_text_lines
	local lines<const>, line_map<const> = wrap('alpha beta gamma', 10, '> ', '  ')
	assert(#lines == 3, 'wrap_text_lines line count mismatch')
	assert(lines[1] == '> alpha' and lines[2] == '  beta' and lines[3] == '  gamma', 'wrap_text_lines content mismatch')
	assert(line_map[1] == 1 and line_map[2] == 1 and line_map[3] == 1, 'wrap_text_lines map mismatch')

	local logical_lines<const>, logical_map<const> = wrap('one\n\nthree', 5)
	assert(#logical_lines == 3, 'wrap_text_lines logical line count mismatch')
	assert(logical_lines[1] == 'one' and logical_lines[2] == '' and logical_lines[3] == 'three', 'wrap_text_lines logical content mismatch')
	assert(logical_map[1] == 1 and logical_map[2] == 2 and logical_map[3] == 3, 'wrap_text_lines logical map mismatch')

	local utf8_lines<const>, utf8_map<const> = wrap('áβ c', 3)
	assert(#utf8_lines == 2 and utf8_lines[1] == 'áβ' and utf8_lines[2] == 'c', 'wrap_text_lines UTF-8 content mismatch')
	assert(utf8_map[1] == 1 and utf8_map[2] == 1, 'wrap_text_lines UTF-8 map mismatch')

	local ok<const>, message<const> = pcall(function() wrap('x', 2, '>>>') end)
	assert(not ok and message == 'wrap_text_lines prefix exceeds max_chars.', 'wrap_text_lines prefix failure mismatch')
end

function __bmsx_host_test.update(_frame)
	return true
end
