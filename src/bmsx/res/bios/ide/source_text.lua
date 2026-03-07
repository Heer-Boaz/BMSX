-- source_text.lua

local source_text = {}

source_text.newline = "\n"

local text_snapshot_cache = setmetatable({}, { __mode = "k" })

function source_text.text_from_lines(lines)
	return table.concat(lines, source_text.newline)
end

function source_text.split_text(text)
	local lines = {}
	local start_index = 1
	local write_index = 1
	local length = #text
	for index = 1, length do
		if string.byte(text, index) == 10 then
			lines[write_index] = string.sub(text, start_index, index - 1)
			write_index = write_index + 1
			start_index = index + 1
		end
	end
	lines[write_index] = string.sub(text, start_index, length)
	return lines
end

function source_text.get_text_snapshot(buffer)
	local version = buffer.version
	local cached = text_snapshot_cache[buffer]
	if cached and cached.v == version then
		return cached.s
	end
	local snapshot = buffer:get_text()
	if cached then
		cached.v = version
		cached.s = snapshot
	else
		text_snapshot_cache[buffer] = { v = version, s = snapshot }
	end
	return snapshot
end

return source_text
