module<const>

local columns<const> = 80
local rows<const> = 40
local scrollback_rows<const> = 128
local history_capacity<const> = 16
local vram_x<const> = 704
local vram_y<const> = 720

return {
	columns = columns,
	rows = rows,
	scrollback_rows = scrollback_rows,
	history_capacity = history_capacity,
	vram_x = vram_x,
	vram_y = vram_y,
	vram_origin = vram_x | (vram_y << 16),
}
