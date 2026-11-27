local ids<const> = require('kernel/bios_table_ids')

return function(target, metatable)
	blua32.svc_value(ids.set_metatable, target, metatable)
	return target
end
