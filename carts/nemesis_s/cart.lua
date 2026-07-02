mem[0x08000084] = 0x00000000
require('cartlib/prelude')
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/index')
local director_module<const> = require('director')
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
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
	mem[0x08000008] = 0
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_subsystem_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	vdp_load_slot(0x00000000, 0)
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
mem[irq_mask_addr] = irq_vblank | irq_apu
new_game()
mem[0x08000194] = 0x00000001
wait_vblank()

while true do
	update_world()
	mem[0x08000194] = 0x00000001
	wait_vblank()
	vdp_stream_cursor = 0x080c0000
	draw_world()
	vdp_stream_finish()
	do
		local used_bytes<const> = vdp_stream_cursor - 0x080c0000
		if used_bytes ~= 0 then
			mem[0x08000110] = 0x080c0000
			mem[0x08000114] = 0x0800007c
			mem[0x08000118] = used_bytes
			mem[0x0800011c] = 0x00000001
		end
	end
end
