local input<const> = require('kernel/byte_string_input')
local tointeger<const> = __bmsx_tointeger

return function(address, count)
	return blua32.svc_value(input.syscall_id, tointeger(address), tointeger(count))
end
