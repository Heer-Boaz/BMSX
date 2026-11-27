local entries<const> = require('bmsx/startup')

return function(target, ...)
	-- Keep the handler in the caller's incoming variadic area while the
	-- protected body runs. No optimizer-owned local register is a root ABI.
	if __bmsx_type((...)) ~= 'function' then
		__bmsx_error('xpcall error handler must be a function.')
	end
	local body<const> = blua32.closure(entries.protected_body)
	return body(target, ...)
end
