local upload<const> = {}
local gp0<const>: *word = 0x08010238
local gp0_cpu_to_vram<const> = 0xa0000000

local rgba8888_to_direct16<const> = function(color)
	if (color & 0xff000000) == 0 then
		return 0
	end
	local direct16<const> = ((color & 0x000000f8) >> 3) | ((color & 0x0000f800) >> 6) | ((color & 0x00f80000) >> 9)
	return direct16 | 0x00008000
end

function upload.rgba8888_to_direct16_stride(source_addr, source_x, source_y, source_stride, target_x, target_y, width, height)
	*gp0 = gp0_cpu_to_vram
	*gp0 = (target_x & 0x0000ffff) | ((target_y & 0x0000ffff) << 16)
	*gp0 = (width & 0x0000ffff) | ((height & 0x0000ffff) << 16)
	local source_words<const>: *word = source_addr
	local pending_word = 0
	local pending_half = 0
	for row = 0, height - 1 do
		local source_index<const> = (source_y + row) * source_stride + source_x
		for column = 0, width - 1 do
			local pixel<const> = rgba8888_to_direct16(source_words[source_index + column])
			if pending_half == 0 then
				pending_word = pixel
				pending_half = 1
			else
				*gp0 = pending_word | (pixel << 16)
				pending_half = 0
			end
		end
	end
	if pending_half ~= 0 then
		*gp0 = pending_word
	end
end

return upload
