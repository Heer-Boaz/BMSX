local engine = require('engine')
local player_module = require('player.lua')
local director_module = require('director.lua')
local ui_module = require('ui.lua')
local castle_service_module = require('castle_service.lua')

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
	ui_module.define_ui_fsm()
	player_module.register_player_definition()
	director_module.register_director_definition()
	ui_module.register_ui_definition()
	castle_service_module.register_castle_service_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	engine.reset()
	local castle_service = engine.create_service(castle_service_module.castle_service_def_id, {
		id = castle_service_module.castle_service_instance_id,
	})
	local room = castle_service:initialize('castle_stone_03')
	local spawn = room.spawn

	spawn_object(player_module.player_def_id, {
		id = player_module.player_instance_id,
		room = room,
		game_service_id = castle_service_module.castle_service_instance_id,
		spawn_x = spawn.x,
		spawn_y = spawn.y,
		pos = { x = spawn.x, y = spawn.y, z = 140 },
	})

	spawn_object(director_module.director_def_id, {
		id = director_module.director_instance_id,
		room = room,
		pos = { x = 0, y = 0, z = 0 },
	})

	spawn_object(ui_module.ui_def_id, {
		id = ui_module.ui_instance_id,
		player_id = player_module.player_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
end

while true do
	wait_vblank()
	service_irqs()
	engine.update(game.deltatime)
end
