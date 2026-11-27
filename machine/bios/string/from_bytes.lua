local ids<const> = require('kernel/heap_control_ids')
local tointeger<const> = __bmsx_tointeger

return function(address, count)
	return blua32.svc_value(ids.string_from_bytes, tointeger(address), tointeger(count))
end
