module<const>

local columns<const> = 64
local rows<const> = 32
local scrollback_rows<const> = 128
local history_capacity<const> = 16
local vram_x<const> = 768
local vram_y<const> = 832

return {
	columns = columns,
	rows = rows,
	scrollback_rows = scrollback_rows,
	history_capacity = history_capacity,
	vram_x = vram_x,
	vram_y = vram_y,
	vram_origin = vram_x | (vram_y << 16),
}
