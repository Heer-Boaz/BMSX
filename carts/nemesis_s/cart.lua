require('cartlib/prelude')
local constants<const> = require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/index')
local director_module<const> = require('director')
local irq_vblank<const> = 0x0010
local vblank_count = 0

local wait_vblank<const> = function()
	local observed<const> = vblank_count
	repeat
		halt_until_irq
	until vblank_count ~= observed
end

function init()
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
	mem[sys_vdp_dither] = 0
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_subsystem_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	vdp_load_slot(sys_vdp_slot_primary, 0)
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
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = 70 },
	})
end

init()
new_game()
	mem[sys_inp_ctrl] = inp_ctrl_arm
	wait_vblank()

	while true do
		update_world()
		mem[sys_inp_ctrl] = inp_ctrl_arm
		wait_vblank()
		vdp_stream_cursor = sys_vdp_stream_base
		draw_world()
		vdp_stream_finish()
		do
			local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
			if used_bytes ~= 0 then
				mem[sys_dma_src] = sys_vdp_stream_base
				mem[sys_dma_dst] = sys_vdp_fifo
				mem[sys_dma_len] = used_bytes
				mem[sys_dma_ctrl] = dma_ctrl_start
			end
		end
	end
