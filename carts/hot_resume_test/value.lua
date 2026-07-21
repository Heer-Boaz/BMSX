local get<const> = function()
	-- hot-resume-module-edit-point
	return 0
end

return {
	get = get,
}
