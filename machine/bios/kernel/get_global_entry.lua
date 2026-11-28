local ids<const> = require('kernel/bios_table_ids')

return function(name)
	return blua32.svc_value(ids.namespace, name)
end
