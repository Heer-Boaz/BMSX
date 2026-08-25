local assets<const> = require('bmsx/system_assets')
local terminal_layout<const> = require('tty/layout')

-- The standard system reservation is the bounding region of the firmware
-- terminal surface and the packed system texture. The texture producer already
-- wrote its physical destination and extent into the ordinary GP0 upload
-- header, so this BIOS boundary publishes those retained words instead of
-- duplicating a cart-visible layout constant.
return function()
	local texture_upload<const>: *word = assets.bin_gx_system_texture_addr
	local texture_origin<const> = texture_upload[1]
	local texture_size<const> = texture_upload[2]
	local texture_x<const> = texture_origin & 0x0000ffff
	local texture_y<const> = texture_origin >> 16
	local texture_right<const> = texture_x + (texture_size & 0x0000ffff)
	local texture_bottom<const> = texture_y + (texture_size >> 16)

	local left = terminal_layout.vram_x
	local top = terminal_layout.vram_y
	local right = left + terminal_layout.width
	local bottom = top + terminal_layout.height
	if texture_x < left then left = texture_x end
	if texture_y < top then top = texture_y end
	if texture_right > right then right = texture_right end
	if texture_bottom > bottom then bottom = texture_bottom end
	return (left & 0x0000ffff) | ((top & 0x0000ffff) << 16),
		((right - left) & 0x0000ffff) | (((bottom - top) & 0x0000ffff) << 16)
end
