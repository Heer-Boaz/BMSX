local constants = require('constants')
local fighter_module = require('fighter')
local arena_module = require('arena')

local service_irqs<const> = function()
	local flags = mem[sys_irq_flags]
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

	fighter_module.define_fighter_fsm()
	fighter_module.register_fighter_definition()
	arena_module.register_arena_definition()
	vdp_load_slot(sys_vdp_slot_primary, 0)
end

function new_game()
	mem[sys_inp_player] = 1
	reset()

	inst(arena_module.arena_def_id, {
		id = arena_module.arena_instance_id,
		pos = { x = 0, y = 0, z = constants.z.background },
	})

	inst(fighter_module.fighter_def_id, {
		id = fighter_module.player_instance_id,
		role = fighter_module.player_role,
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = constants.z.fighter },
		target_id = fighter_module.enemy_instance_id,
	})

	inst(fighter_module.fighter_def_id, {
		id = fighter_module.enemy_instance_id,
		role = fighter_module.enemy_role,
		pos = { x = constants.enemy.start_x, y = constants.enemy.start_y, z = constants.z.fighter },
		target_id = fighter_module.player_instance_id,
		max_health = constants.enemy.max_health,
		health = constants.enemy.max_health,
		width = constants.enemy.width,
		height = constants.enemy.height,
	})
end

	mem[sys_inp_ctrl] = inp_ctrl_arm
	local flags
	repeat
		halt_until_irq
		flags = service_irqs()
	until (flags & irq_vblank) ~= 0

	while true do
		update_world()
		mem[sys_inp_ctrl] = inp_ctrl_arm
		repeat
			halt_until_irq
			flags = service_irqs()
		until (flags & irq_vblank) ~= 0
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
