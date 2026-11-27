local ids<const> = require('kernel/heap_control_ids')
return function(system, system_mounted, cart0, cart0_mounted, cart1, cart1_mounted)
	return blua32.svc_value(ids.bind_live_image, system, system_mounted, cart0, cart0_mounted, cart1, cart1_mounted)
end
