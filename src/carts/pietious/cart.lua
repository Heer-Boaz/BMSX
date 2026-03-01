local constants = require('constants')
local enemy_registry = require('enemy_registry')
local progression = require('progression')
local pietious_font = require('pietious_font')
local player_module = require('player')
local room_module = require('room')
local draaideur_module = require('draaideur')
local transition_module = require('transition')
local shrine_module = require('shrine')
local seal_module = require('seal')
local lithograph_module = require('lithograph')
local lithograph_screen_module = require('lithograph_screen')
local item_screen_module = require('item_screen')
local ui_module = require('ui')
local loot_drop_module = require('loot_drop')
local world_item_module = require('world_item')
local rock_module = require('rock')
local pepernoot_projectile_module = require('pepernoot_projectile')
local enemy_explosion_module = require('enemy_explosion')
local elevator_module = require('elevator')
local castle_module = require('castle')
local world_entrance_module = require('world_entrance')
local daemon_cloud_module = require('daemon_cloud')
local director_module = require('director')
local collision_profiles = require('collision_profiles')
local castle_map = require('castle_map')

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

local function dispatch_irqs()
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
	object('pietolon').weapon_level = constants.hud.weapon_level
	object('pietolon'):emit_weapon_changed()
	local castle = object('c')
	progression.set(castle, 'staff1destroyed', true)
	progression.set(castle, 'staff2destroyed', true)
	progression.set(castle, 'staff3destroyed', true)
end

function init()
	poke(sys_vdp_dither, 0)
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	pietious_font.register_fonts()

	player_module.define_player_fsm()
	enemy_registry.register_all()
	room_module.define_room_fsm()
	draaideur_module.define_draaideur_fsm()
	transition_module.define_transition_fsm()
	lithograph_screen_module.define_lithograph_screen_fsm()
	item_screen_module.define_item_screen_fsm()
	ui_module.define_ui_fsm()
	loot_drop_module.define_loot_drop_fsm()
	world_item_module.define_world_item_fsm()
	rock_module.define_rock_fsm()
	pepernoot_projectile_module.define_pepernoot_projectile_fsm()
	enemy_explosion_module.define_enemy_explosion_fsm()
	daemon_cloud_module.define_daemon_cloud_fsm()
	director_module.define_director_fsm()
	elevator_module.define_elevator_fsm()
	player_module.register_player_definition()
	elevator_module.register_elevator_definition()
	room_module.register_room_definition()
	draaideur_module.register_draaideur_definition()
	transition_module.register_transition_definition()
	shrine_module.register_shrine_definition()
	shrine_module.register_room_shrine_definition()
	seal_module.register_seal_definition()
	lithograph_module.register_lithograph_definition()
	lithograph_screen_module.register_lithograph_screen_definition()
	item_screen_module.register_item_screen_definition()
	ui_module.register_ui_definition()
	loot_drop_module.register_loot_drop_definition()
	world_item_module.register_world_item_definition()
	rock_module.register_rock_definition()
	pepernoot_projectile_module.register_pepernoot_projectile_definition()
	enemy_explosion_module.register_enemy_explosion_definition()
	castle_module.register_castle_definition()
	world_entrance_module.register_world_entrance_definition()
	daemon_cloud_module.register_daemon_cloud_definition()
	director_module.register_director_definition()
	register_collision_profiles()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	reset()
	add_space('main')
	add_space('transition')
	add_space('shrine')
	add_space('lithograph')
	add_space('item')
	add_space('ui')
	set_space('main')

	inst('castle', {
		id = 'c',
	})

	inst('room', {
		id = 'room',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('player', {
		id = 'pietolon',
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = 140 },
	})
	grant_starting_loadout()
	object('c'):initialize(castle_map.start_room_number)

	inst('transition', {
		id = 'transition',
		space_id = 'transition',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('shrine', {
		id = 'shrine',
		space_id = 'shrine',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('lithograph_screen', {
		id = 'lithograph',
		space_id = 'lithograph',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('item_screen', {
		id = 'item_screen',
		space_id = 'item',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('ui', {
		id = 'ui',
		pos = { x = 0, y = 0, z = 0 },
	})

	inst('director', {
		id = 'd',
	})

end

while true do
	wait_vblank()
	dispatch_irqs()
	update()
end
