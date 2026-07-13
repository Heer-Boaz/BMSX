local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('cartlib/gx/image')
local dma<const> = require('system/dma')
gx_gpu.reset_256x192_pal()
require('cartlib/prelude')
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/index')
local director_module<const> = require('director')
local irq_mask_register<const>: *word = 0x08000010
local input_control_register<const>: *word = 0x0800006c
local irq_vblank<const> = 0x0004
local irq_apu<const> = 0x0020
local vblank_count = 0

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
	*irq_mask_register = irq_vblank | irq_apu
	gx_clear_color(0xff000000)
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	local cart_texture<const> = gx_image.packed_texture(0)
	local texture_meta<const> = cart_texture.meta
	gx_image.bind_direct16_residency(0, 0, 256)
	gx_gpu.begin_direct16_upload(0, 256, texture_meta.width, texture_meta.height)
	dma.copy_to_gp0(cart_texture.texture_addr, cart_texture.texture_len)
end

function new_game()
	reset()
	inst(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		pos = { x = 0, y = 0, z = 0 },
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
