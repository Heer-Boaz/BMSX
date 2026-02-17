local constants = require('constants')
local enemy_registry = require('enemy_registry')
local player_module = require('player')
local room_module = require('room')
local transition_module = require('transition')
local shrine_module = require('shrine')
local item_screen_module = require('item_screen')
local ui_module = require('ui')
local loot_drop_module = require('loot_drop')
local world_item_module = require('world_item')
local item_service_module = require('item_service')
local rock_module = require('rock')
local rock_service_module = require('rock_service')
local pepernoot_projectile_module = require('pepernoot_projectile')
local enemy_explosion_module = require('enemy_explosion')
local castle_service_module = require('castle_service')
local elevator_service_module = require('elevator_service')
local director_module = require('director')
local collision_profiles = require('collision_profiles')

local function register_collision_profiles()
	collision_profiles.define('player', {
		layer = constants.collision.player_layer,
		mask = constants.collision.player_mask,
	})
	collision_profiles.define('enemy', {
		layer = constants.collision.enemy_layer,
		mask = constants.collision.enemy_mask,
	})
	collision_profiles.define('projectile', {
		layer = constants.collision.projectile_layer,
		mask = constants.collision.projectile_mask,
	})
	collision_profiles.define('pickup', {
		layer = constants.collision.pickup_layer,
		mask = constants.collision.pickup_mask,
	})
end

local function service_irqs()
	local flags = peek(sys_irq_flags)
	if flags ~= 0 then
		irq(flags)
	end
end

local function grant_starting_loadout()
	local player = object('pietolon')
	player.inventory_items['keyworld1'] = true
	player.inventory_items['spyglass'] = true
	player.inventory_items['halo'] = true
	player.inventory_items['lamp'] = true
	player.inventory_items['schoentjes'] = true
	player.inventory_items['greenvase'] = true
	player.inventory_items['map_world1'] = true
	player.inventory_items['pepernoot'] = true
	player:equip_subweapon('pepernoot')
	player.weapon_level = constants.hud.weapon_level
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
	enemy_registry.register_all()
	room_module.define_room_fsm()
	transition_module.define_transition_fsm()
	shrine_module.define_shrine_fsm()
	item_screen_module.define_item_screen_fsm()
	ui_module.define_ui_fsm()
	loot_drop_module.define_loot_drop_fsm()
	world_item_module.define_world_item_fsm()
	item_service_module.define_item_service_fsm()
	rock_module.define_rock_fsm()
	rock_service_module.define_rock_service_fsm()
	pepernoot_projectile_module.define_pepernoot_projectile_fsm()
	enemy_explosion_module.define_enemy_explosion_fsm()
	castle_service_module.define_castle_service_fsm()
	elevator_service_module.define_elevator_service_fsm()
	director_module.define_director_fsm()
	player_module.register_player_definition()
	room_module.register_room_definition()
	transition_module.register_transition_definition()
	shrine_module.register_shrine_definition()
	item_screen_module.register_item_screen_definition()
	ui_module.register_ui_definition()
	loot_drop_module.register_loot_drop_definition()
	world_item_module.register_world_item_definition()
	item_service_module.register_item_service_definition()
	rock_module.register_rock_definition()
	rock_service_module.register_rock_service_definition()
	pepernoot_projectile_module.register_pepernoot_projectile_definition()
	enemy_explosion_module.register_enemy_explosion_definition()
	castle_service_module.register_castle_service_definition()
	elevator_service_module.register_elevator_service_definition()
	director_module.register_director_service_definition()
	register_collision_profiles()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	reset()
	add_space('castle')
	add_space('transition')
	add_space('shrine')
	add_space('item')
	add_space('ui')
	set_space('castle')

	local castle_service = create_service('castle_service.def', {
		id = 'c',
	})
	local room = castle_service:initialize(1)

	inst('player.def', {
		id = 'pietolon',
		room = room,
		space_id = room.space_id,
		spawn_x = constants.player.start_x,
		spawn_y = constants.player.start_y,
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = 140 },
	})
	grant_starting_loadout()

	inst('room.def', {
		id = 'room',
		room = room,
		space_id = room.space_id,
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('transition.def', {
		id = 'transition',
		space_id = 'transition',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('shrine.def', {
		id = 'shrine',
		space_id = 'shrine',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('item_screen.def', {
		id = 'item_screen',
		space_id = 'item',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('ui.def', {
		id = 'ui',
		space_id = room.space_id,
		pos = { x = 0, y = 0, z = 0 },
	})

	create_service('director_service.def', {
		id = 'd',
	})

	create_service('item_service.def', {
		id = 'i',
	})

	local elevator_service = create_service('elevator_service.def', {
		id = 'elevator_service',
		castle_service_id = 'c',
	})
	elevator_service:activate()

	create_service('rock_service.def', {
		id = 'r',
	})
end

while true do
	wait_vblank()
	service_irqs()
	update()
end
