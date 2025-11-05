local background_color = 4
local text_color = 15

local instructions = {
	'BMSX LUA SHELL READY.',
	'',
	'Press ESC to toggle the console editor.',
	'Edit this file to execute ad-hoc Lua code.',
	'Choose REBOOT/RESUME to run your changes.',
	'Boaz is trouwens stoer',
	'Heel erg stoer',
}

function init()
	
end

function update(_dt)
end

function draw()
	cls(background_color)
	for index = 1, #instructions+1 do
		print(instructions[index], 8, 8 + (index - 1) * 16, text_color)
	end
end
