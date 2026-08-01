local terminal<const> = require('tty/terminal')

local console<const> = {}

local system_print_data<const>: *word = 0x0801022c
local system_print_count<const>: *word = 0x08010230
local palette_text<const> = terminal.palette_text

function console.flush()
	while *system_print_count ~= 0 do
		terminal.write_code(*system_print_data, palette_text)
	end
end

return console
