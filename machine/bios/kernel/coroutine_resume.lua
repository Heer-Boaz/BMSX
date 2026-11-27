local types<const> = require('kernel/value_type')

return function(target, ...)
	if blua32.tag(target) ~= types.thread_tag then __bmsx_error('Invalid argument.') end
	local current<const> = (__bmsx_coroutine_running())
	for i = 0, __bmsx_frame_count(current) - 1 do
		local _<const>, _<const>, _<const>, _<const>, _<const>, exception<const> = __bmsx_frame_header(current, i)
		if exception then return false, 'cannot resume coroutine across a hardware exception' end
	end
	blua32.svc(target)
end
