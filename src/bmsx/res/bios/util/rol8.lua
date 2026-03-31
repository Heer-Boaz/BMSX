local rol8<const> = function(value)
	local rotated = value + value
	if rotated >= 256 then
		rotated = rotated - 255
	end
	return rotated
end

return rol8
