local ids<const> = require('kernel/bios_table_ids')

return function(name, replacement)
	blua32.svc_value(ids.set_global, name, replacement)
end
