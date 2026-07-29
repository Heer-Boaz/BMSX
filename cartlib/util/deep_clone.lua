local deep_clone<const> = function(value)
	if type(value) ~= "table" then
		return value
	end
	local out<const> = {}
	for k, v in pairs(value) do
		out[k] = deep_clone(v)
	end
	return out
end

return deep_clone