local constants = require('constants')
local level_module = require('level')
local player_module = require('player_asm')
local director_module = require('director')

local service_irqs<const> = function()
	local flags = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
end

function init()
	mem[sys_vdp_dither] = 0
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	player_module.define_player_fsm()
	director_module.define_director_fsm()
	player_module.register_player_definition()
	director_module.register_director_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	reset()
	local level = level_module.create_level(constants.dkc.default_level_context)
	local spawn = level.spawn

	inst(player_module.player_def_id, {
		id = player_module.player_instance_id,
		level = level,
		pos = { x = spawn.x, y = spawn.y, z = 300 },
	})

	inst(director_module.director_def_id, {
		id = director_module.director_instance_id,
		level = level,
		player_id = player_module.player_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
end

	while true do
		wait_vblank()
		service_irqs()
		vdp_stream_cursor = sys_vdp_stream_base
		update(2)
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
