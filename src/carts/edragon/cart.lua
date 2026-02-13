local constants = require('constants')
local fighter_module = require('fighter')
local arena_module = require('arena')

local function service_irqs()
	local flags = peek(sys_irq_flags)
	if flags ~= 0 then
		irq(flags)
	end
end

function init()
	poke(sys_vdp_dither, 0)
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)

	fighter_module.define_fighter_fsm()
	fighter_module.register_fighter_definition()
	arena_module.register_arena_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	reset()

	spawn_object(arena_module.arena_def_id, {
		id = arena_module.arena_instance_id,
		pos = { x = 0, y = 0, z = constants.z.background },
	})

	spawn_object(fighter_module.fighter_def_id, {
		id = fighter_module.player_instance_id,
		role = fighter_module.player_role,
		spawn_x = constants.player.start_x,
		spawn_y = constants.player.start_y,
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = constants.z.fighter },
		target_id = fighter_module.enemy_instance_id,
	})

	spawn_object(fighter_module.fighter_def_id, {
		id = fighter_module.enemy_instance_id,
		role = fighter_module.enemy_role,
		spawn_x = constants.enemy.start_x,
		spawn_y = constants.enemy.start_y,
		pos = { x = constants.enemy.start_x, y = constants.enemy.start_y, z = constants.z.fighter },
		target_id = fighter_module.player_instance_id,
		max_health = constants.enemy.max_health,
		health = constants.enemy.max_health,
		width = constants.enemy.width,
		height = constants.enemy.height,
	})
end

while true do
	wait_vblank()
	service_irqs()
	update()
end
