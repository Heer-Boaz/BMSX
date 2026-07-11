local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_256x192_pal()
require('cartlib/prelude')
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/index')
local director_module<const> = require('director')
local irq_mask_register<const>: *word = 0x0800010c
local input_control_register<const>: *word = 0x08000194
local irq_img_done<const> = 0x0004
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0
nemesis_s_atlas_decoded = false
nemesis_s_atlas_ready = false

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

function init()
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
	on_irq(irq_img_done, function()
		nemesis_s_atlas_decoded = true
	end)
	*irq_mask_register = irq_vblank | irq_apu | irq_img_done
	gx_clear_color(0xff000000)
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_subsystem_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	gx_load_atlas(0)
end

function new_game()
	reset()
	inst_subsystem(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
	})
	inst(director_module.director_def_id, {
		id = director_module.director_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	inst(player_module.player_def_id, {
		id = player_module.player_instance_id,
		player_index = 1,
		pos = { x = player_start_x, y = player_start_y, z = 70 },
	})
end

init()
*input_control_register = 0x00000001
repeat
	wait_vblank()
	*input_control_register = 0x00000001
until nemesis_s_atlas_decoded
gx_upload_atlas(0)
nemesis_s_atlas_ready = true
*irq_mask_register = irq_vblank | irq_apu
new_game()
*input_control_register = 0x00000001
wait_vblank()

while true do
	update_world()
	*input_control_register = 0x00000001
	wait_vblank()
	gx_clear_color(0xff000000)
	draw_world()
end
