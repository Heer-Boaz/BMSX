local ids<const> = require('kernel/heap_control_ids')

return function(...)
	return blua32.svc_value(ids.string_chars)
end
