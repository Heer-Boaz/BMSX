local text = {}

function text.split_lines(value)
	local lines = {}
	for line in value:gmatch('[^\r\n]+') do
		lines[#lines + 1] = line
	end
	return lines
end

return text
