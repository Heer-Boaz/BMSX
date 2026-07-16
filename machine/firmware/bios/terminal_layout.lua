module<const>

local columns<const> = 64
local rows<const> = 32
local scrollback_rows<const> = 128
local history_capacity<const> = 16

return {
	columns = columns,
	rows = rows,
	scrollback_rows = scrollback_rows,
	history_capacity = history_capacity,
}
