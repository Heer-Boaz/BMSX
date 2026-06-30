string.len = function(value)
	return #value
end


string.rep = function(value, count_arg, separator)
	local count<const> = count_arg == nil and 1 or count_arg // 1
	if count <= 0 then
		return ''
	end
	local output = ''
	local chunk = value
	local remaining = count
	if separator ~= nil then
		output = value
		chunk = separator .. value
		remaining = count - 1
	end
	while remaining > 0 do
		if remaining % 2 == 1 then
			output = output .. chunk
		end
		remaining = remaining // 2
		if remaining > 0 then
			chunk = chunk .. chunk
		end
	end
	return output
end

return string
