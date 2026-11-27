local entries<const> = require('bmsx/startup')

return function(...)
	local current<const>, main<const> = __bmsx_coroutine_running()
	local yieldable<const> = blua32.closure(entries.coroutine_yieldable)
	if main or not yieldable(current) then __bmsx_error('Invalid argument.') end
	blua32.svc(nil)
end
