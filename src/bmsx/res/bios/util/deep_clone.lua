local function deep_clone(value)
	if type(value) ~= "table" then
		return value
	end
	local out = {}
	for k, v in pairs(value) do
		out[k] = deep_clone(v)
	end
	return out
end

return deep_clone