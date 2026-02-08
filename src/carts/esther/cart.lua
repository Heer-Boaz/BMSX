local engine = require('engine')
local level_module = require('level.lua')
local player_module = require('player.lua')
local director_module = require('director.lua')

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
	player_module.define_player_fsm()
	director_module.define_director_fsm()
	player_module.register_player_definition()
	director_module.register_director_definition()
end

function new_game()
	engine.reset()
	local level = level_module.create_level()
	local spawn = level.spawn
	spawn_object(player_module.player_def_id, {
		id = player_module.player_instance_id,
		level = level,
		spawn_x = spawn.x,
		spawn_y = spawn.y,
		pos = { x = spawn.x, y = spawn.y, z = 300 },
	})
	spawn_object(director_module.director_def_id, {
		id = director_module.director_instance_id,
		level = level,
		player_id = player_module.player_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
end

while true do
	wait_vblank()
	service_irqs()
	engine.update(game.deltatime)
end
