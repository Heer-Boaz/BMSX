local engine = require('engine')
local constants = require('constants.lua')
local player_module = require('player.lua')
local room_view_module = require('room_view.lua')
local transition_view_module = require('transition_view.lua')
local item_screen_module = require('item_screen.lua')
local ui_module = require('ui.lua')
local castle_service_module = require('castle_service.lua')
local flow_service_module = require('flow_service.lua')

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
	room_view_module.define_room_view_fsm()
	transition_view_module.define_transition_view_fsm()
	item_screen_module.define_item_screen_fsm()
	ui_module.define_ui_fsm()
	flow_service_module.define_flow_service_fsm()
	player_module.register_player_definition()
	room_view_module.register_room_view_definition()
	transition_view_module.register_transition_view_definition()
	item_screen_module.register_item_screen_definition()
	ui_module.register_ui_definition()
	castle_service_module.register_castle_service_definition()
	flow_service_module.register_flow_service_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	engine.reset()
	engine.add_space(constants.spaces.castle)
	engine.add_space(constants.spaces.transition)
	engine.add_space(constants.spaces.item)
	engine.add_space(constants.spaces.ui)
	engine.set_space(constants.spaces.castle)

	local castle_service = engine.create_service(castle_service_module.castle_service_def_id, {
		id = castle_service_module.castle_service_instance_id,
	})
	engine.create_service(flow_service_module.flow_service_def_id, {
		id = flow_service_module.flow_service_instance_id,
	})
	local room = castle_service:initialize()
	local spawn = room.spawn

	spawn_object(player_module.player_def_id, {
		id = player_module.player_instance_id,
		room = room,
		game_service_id = castle_service_module.castle_service_instance_id,
		spawn_x = spawn.x,
		spawn_y = spawn.y,
		pos = { x = spawn.x, y = spawn.y, z = 140 },
	})

	spawn_object(room_view_module.room_view_def_id, {
		id = room_view_module.room_view_instance_id,
		room = room,
		game_service_id = castle_service_module.castle_service_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})

	spawn_object(transition_view_module.transition_view_def_id, {
		id = transition_view_module.transition_view_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})

	spawn_object(item_screen_module.item_screen_def_id, {
		id = item_screen_module.item_screen_instance_id,
		player_id = player_module.player_instance_id,
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
