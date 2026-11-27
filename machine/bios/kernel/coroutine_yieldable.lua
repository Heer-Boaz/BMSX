local entries<const> = require('bmsx/startup')

return function(thread)
	for i = __bmsx_frame_count(thread) - 1, 0, -1 do
		local fn<const>, _<const>, _<const>, completion<const>, domain<const>, exception<const> = __bmsx_frame_header(thread, i)
		if exception or completion or (domain == -1 and fn == entries.protected_handler) then return false end
	end
	return true
end
