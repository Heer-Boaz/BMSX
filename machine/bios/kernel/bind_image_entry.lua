local ids<const> = require('kernel/heap_control_ids')
return function(slot, staged, mounted)
	return blua32.svc_value(ids.bind_live_image, slot, staged, mounted)
end
