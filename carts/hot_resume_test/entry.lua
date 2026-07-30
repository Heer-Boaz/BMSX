module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
gx_gpu.reset_320x240()
require('cartlib/prelude')
local hot_value<const> = require('value')

local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local irq_apu<const> = 0x0020
local vblank_count = 0
hot_resume_init_count = 0
hot_resume_new_game_count = 0

function init()
	hot_resume_init_count = hot_resume_init_count + 1
	hot_resume_module_probe = hot_value.get()
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
end

function new_game()
	hot_resume_new_game_count = hot_resume_new_game_count + 1
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

init()
*irq_mask_register = irq_vblank | irq_apu
new_game()
*input_control_register = 0x00000001
wait_vblank()

while true do
	-- hot-resume-edit-point
	*input_control_register = 0x00000001
	wait_vblank()
	gx_clear_color(0xff000000)
end
