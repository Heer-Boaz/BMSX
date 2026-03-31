local function wrap_text_lines(text, max_chars)
	local lines = {}
	local line_map = {}
	local pos = 1
	while pos <= #text do
		local chunk = string.sub(text, pos, pos + max_chars - 1)
		table.insert(lines, chunk)
		table.insert(line_map, 1)
		pos = pos + max_chars
	end
	return lines, line_map
end

return wrap_text_lines
