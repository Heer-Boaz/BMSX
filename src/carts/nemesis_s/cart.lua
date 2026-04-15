local constants<const> = require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player')
local director_module<const> = require('director')

local service_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

function init()
	mem[sys_vdp_dither] = 0
	mem[sys_inp_player] = 1
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_subsystem_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	mem[sys_inp_player] = 1
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

	mem[sys_inp_ctrl] = inp_ctrl_arm
	while true do
		local flags
		repeat
			halt_until_irq
			flags = service_irqs()
		until (flags & irq_vblank) ~= 0
		vdp_stream_cursor = sys_vdp_stream_base
		update()
		do
			local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
			if used_bytes ~= 0 then
				mem[sys_dma_src] = sys_vdp_stream_base
				mem[sys_dma_dst] = sys_vdp_fifo
				mem[sys_dma_len] = used_bytes
				mem[sys_dma_ctrl] = dma_ctrl_start
			end
		end
		mem[sys_inp_ctrl] = inp_ctrl_arm
	end
