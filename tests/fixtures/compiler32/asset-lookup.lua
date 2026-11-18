require('bootstrap')
local rom_dir<const> = require('cartlib/rom_dir')
local count = 0
local addresses = 0
local lengths = 0
local add<const> = function(id)
	local record<const> = rom_dir.system_image(id)
	count = count + 1
	addresses = addresses + record.addr
	lengths = lengths + record.len
end
add('')
local long_id = ''
for _ = 1, 500 do long_id = long_id .. 'a' end
add(long_id)
for index = 0, 95 do add('asset-' .. index .. '-texture') end
return count, addresses, lengths
