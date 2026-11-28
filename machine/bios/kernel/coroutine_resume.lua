local types<const> = require('kernel/value_type')

return function(target, ...)
	if blua32.tag(target) ~= types.thread_tag then __bmsx_error('Invalid argument.') end
	blua32.svc(target)
end
