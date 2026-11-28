local entries<const> = require('bmsx/startup')
local types<const> = require('kernel/value_type')

return function(target, ...)
	-- Keep the handler in the caller's incoming variadic area while the
	-- protected body runs. No optimizer-owned local register is a root ABI.
	local tag<const> = blua32.tag((...))
	if tag ~= types.closure_tag and tag ~= types.builtin_tag and tag ~= types.code_tag then
		__bmsx_error('xpcall error handler must be a function.')
	end
	local body<const> = blua32.code_function(entries.protected_body)
	return body(target, ...)
end
