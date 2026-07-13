local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_256x192_pal()
require('cartlib/prelude')
require('constants')
local enemy_registry<const> = require('enemy/registry')
local progression<const> = require('cartlib/progression')
local pietious_font<const> = require('pietious_font')
local player_module<const> = require('player/index')
local room_module<const> = require('room/index')
local draaideur_module<const> = require('draaideur')
local transition_module<const> = require('transition')
local shrine_module<const> = require('shrine')
local seal_module<const> = require('seal')
local lithograph_module<const> = require('lithograph/index')
local lithograph_screen_module<const> = require('lithograph/screen')
local item_screen_module<const> = require('item_screen')
local ui_module<const> = require('ui')
local loot_drop_module<const> = require('loot_drop')
local world_item_module<const> = require('world/item')
local rock_module<const> = require('rock')
local pepernoot_projectile_module<const> = require('pepernoot_projectile')
local enemy_explosion_module<const> = require('enemy/explosion')
local elevator_module<const> = require('elevator/index')
local elevator_update_system_module<const> = require('elevator/update_system')
local castle_module<const> = require('castle/index')
local world_entrance_module<const> = require('world/entrance')
local daemon_cloud_module<const> = require('daemon_cloud')
local director_module<const> = require('director')
local title_screen_module<const> = require('title_screen')
local collision_profiles<const> = require('cartlib/collision_profiles')
local castle_map<const> = require('castle/map')

local init_epoch = 0
local pending_title_boot_epoch = -1

local irq_mask_addr<const> = 0x08000010
local irq_vblank<const> = 0x0004
local irq_apu<const> = 0x0020
local vblank_count = 0

local register_collision_profiles<const> = function()
	collision_profiles.define('player', {
		layer = collision_player_layer,
		mask = collision_player_mask,
	})
	collision_profiles.define('enemy', {
		layer = collision_enemy_layer,
		mask = collision_enemy_mask,
	})
	collision_profiles.define('projectile', {
		layer = collision_projectile_layer,
		mask = collision_projectile_mask,
	})
	collision_profiles.define('pickup', {
		layer = collision_pickup_layer,
		mask = collision_pickup_mask,
	})
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

local grant_starting_loadout<const> = function()
	local player<const> = oget('pietolon')
	player.inventory_items['keyworld1'] = true
	player.inventory_items['spyglass'] = true
	player.inventory_items['halo'] = true
	player.inventory_items['lamp'] = true
	player.inventory_items['schoentjes'] = true
	player.inventory_items['greenvase'] = true
	player.inventory_items['map_world1'] = true
	player.inventory_items['pepernoot'] = true
	player:equip_subweapon('pepernoot')
	oget('pietolon').weapon_level = hud_weapon_level
	oget('pietolon'):emit_weapon_changed()
	local castle<const> = oget('c')
	progression.set(castle, 'staff1destroyed', true)
	progression.set(castle, 'staff2destroyed', true)
	progression.set(castle, 'staff3destroyed', true)
end

local create_world<const> = function(director_boot_mode)
	reset()
	elevator_update_system_module.apply_pipeline()
	add_space('main')
	add_space('title')
	add_space('transition')
	add_space('shrine')
	add_space('lithograph')
	add_space('item')
	add_space('ui')
	set_space('main')

	local c<const> = inst('castle', { id = 'c', })

	inst('room', { id = 'room', })

	inst('player', {
		id = 'pietolon',
		pos = { x = player_start_x, y = player_start_y, z = 140 },
	})
	grant_starting_loadout()
	c:initialize(castle_map.start_room_number, director_boot_mode ~= 'title_screen')

	inst('transition', { id = 'transition', space_id = 'transition', })
	inst('shrine', { id = 'shrine', space_id = 'shrine', })
	inst('lithograph_screen', { id = 'lithograph', space_id = 'lithograph', })
	inst('item_screen', { id = 'item_screen', space_id = 'item', })
	inst('ui', { id = 'ui', pos = { z = draw_z_hud }, })
	inst('title_screen', { id = 'title_screen', space_id = 'title', })
	inst('director', { id = 'd', boot_mode = director_boot_mode, pos = { z = draw_z_director_effect }, })
end

function new_game()
	if pending_title_boot_epoch == init_epoch then
		pending_title_boot_epoch = init_epoch - 1
		create_world('title_screen')
		return
	end
	create_world('room')
end

function init()
	mem[irq_mask_addr] = 0
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
	gx_clear_color(0xff000000)
	pietious_font.register_fonts()

	player_module.define_player_fsm()
	enemy_registry.register_all()
	room_module.define_room_fsm()
	draaideur_module.define_draaideur_fsm()
	transition_module.define_transition_fsm()
	lithograph_screen_module.define_lithograph_screen_fsm()
	item_screen_module.define_item_screen_fsm()
	ui_module.define_ui_fsm()
	shrine_module.define_shrine_fsm()
	loot_drop_module.define_loot_drop_fsm()
	world_item_module.define_world_item_fsm()
	rock_module.define_rock_fsm()
	pepernoot_projectile_module.define_pepernoot_projectile_fsm()
	enemy_explosion_module.define_enemy_explosion_fsm()
	daemon_cloud_module.define_daemon_cloud_fsm()
	title_screen_module.define_title_screen_fsm()
	director_module.define_director_fsm()
	elevator_module.define_elevator_fsm()
	castle_module.define_castle_fsm()
	world_entrance_module.define_world_entrance_fsm()
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
	title_screen_module.register_title_screen_definition()
	director_module.register_director_definition()
	register_collision_profiles()
	init_epoch = init_epoch + 1
	pending_title_boot_epoch = init_epoch
end

-- Pietious owns the hardware cadence explicitly. Input is armed before the
-- VBLANK that samples it, game logic runs during the following visible frame,
-- GP0 submission happens in the next VBLANK, and the extra wait keeps the game
-- tick at half the display refresh rate.
init()
gx_upload_atlas(0)
mem[irq_mask_addr] = irq_vblank | irq_apu
new_game()
mem[0x0800006c] = 0x00000001
wait_vblank()

while true do
	update_world()

	wait_vblank()
	gx_clear_color(0xff000000)
	draw_world()

	mem[0x0800006c] = 0x00000001
	wait_vblank()
end
