module<entry>
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_texture<const> = require('cartlib/gx/texture')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()
local aem<const> = require('cartlib/aem')
local collision2d<const> = require('cartlib/collision/collision2d')
local input<const> = require('cartlib/input/input')
input.add_player(1)
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
require('constants')
local boekfoe_module<const> = require('enemies/boekfoe')
local breakablewall_module<const> = require('enemies/breakablewall')
local cloud_module<const> = require('enemies/cloud')
local crossfoe_module<const> = require('enemies/crossfoe')
local disappearingwall_module<const> = require('enemies/disappearingwall')
local marspeinenaardappel_module<const> = require('enemies/marspeinenaardappel')
local mijterfoe_module<const> = require('enemies/mijterfoe')
local muziekfoe_module<const> = require('enemies/muziekfoe')
local nootfoe_module<const> = require('enemies/nootfoe')
local paperfoe_module<const> = require('enemies/paperfoe')
local stafffoe_module<const> = require('enemies/stafffoe')
local staffspawn_module<const> = require('enemies/staffspawn')
local vlokfoe_module<const> = require('enemies/vlokfoe')
local vlokspawner_module<const> = require('enemies/vlokspawner')
local zakfoe_module<const> = require('enemies/zakfoe')
local progression<const> = require('cartlib/progression')
local pietious_font<const> = require('pietious_font')
local player_module<const> = require('player/player')
local room_module<const> = require('room/room')
local draaideur_module<const> = require('draaideur')
local transition_module<const> = require('transition')
local shrine_module<const> = require('shrine')
local seal_module<const> = require('seal')
local lithograph_module<const> = require('lithograph/lithograph')
local lithograph_screen_module<const> = require('lithograph/screen')
local item_screen_module<const> = require('item_screen')
local ui_module<const> = require('ui')
local loot_drop_module<const> = require('loot_drop')
local world_item_module<const> = require('world/item')
local rock_module<const> = require('rock')
local pepernoot_projectile_module<const> = require('pepernoot_projectile')
local enemy_explosion_module<const> = require('enemies/explosion')
local elevator_module<const> = require('elevator/elevator')
local castle_module<const> = require('castle/castle')
local world_entrance_module<const> = require('world/entrance')
local daemon_cloud_module<const> = require('daemon_cloud')
local director_module<const> = require('director')
local title_screen_module<const> = require('title_screen')
local castle_map<const> = require('castle/map')

local init_epoch = 0
local pending_title_boot_epoch = -1

local irq_mask_register<const>: *word = 0x08000008
local irq_geo_done_error<const> = 0x0018
local irq_apu<const> = 0x0020

local grant_starting_loadout<const> = function(player, castle)
	player.inventory_items['keyworld1'] = true
	player.inventory_items['spyglass'] = true
	player.inventory_items['halo'] = true
	player.inventory_items['lamp'] = true
	player.inventory_items['schoentjes'] = true
	player.inventory_items['greenvase'] = true
	player.inventory_items['map_world1'] = true
	player.inventory_items['pepernoot'] = true
	player:equip_subweapon('pepernoot')
	player.weapon_level = hud_weapon_level
	player:emit_weapon_changed()
	progression.set(castle, 'staff1destroyed', true)
	progression.set(castle, 'staff2destroyed', true)
	progression.set(castle, 'staff3destroyed', true)
end

local create_world<const> = function(director_boot_mode)
	world:clear()

	local castle<const> = world:spawn('castle', { id = 'c', })
	local room<const> = world:spawn('room', { id = 'room', castle = castle, })
	castle.room = room
	local player<const> = world:spawn('player', {
		id = 'pietolon',
		castle = castle,
		room = room,
		pos = { x = player_start_x, y = player_start_y, z = 140 },
	})
	room.player = player
	grant_starting_loadout(player, castle)
	castle:initialize(castle_map.start_room_number, director_boot_mode ~= 'title_screen')

	world:spawn('transition', { id = 'transition', space_id = 'transition', })
	world:spawn('shrine', { id = 'shrine', space_id = 'shrine', })
	world:spawn('lithograph_screen', { id = 'lithograph', space_id = 'lithograph', })
	world:spawn('item_screen', {
		id = 'item_screen',
		space_id = 'item',
		castle = castle,
		room = room,
		player = player,
	})
	local ui<const> = world:spawn('ui', { id = 'ui', player = player, pos = { z = draw_z_hud }, })
	world:spawn('title_screen', { id = 'title_screen', space_id = 'title', })
	local director<const> = world:spawn('director', {
		id = 'd',
		boot_mode = director_boot_mode,
		ui = ui,
		pos = { z = draw_z_director_effect },
	})
	player.director = director
	room.director = director
end

function new_game()
	if pending_title_boot_epoch == init_epoch then
		pending_title_boot_epoch = init_epoch - 1
		create_world('title_screen')
		return
	end
	create_world('room')
end

local function init<init>()
	irq_module.register(vblank.irq_mask, vblank.on_irq)
	irq_module.register(irq_geo_done_error, collision2d.on_geo_irq)
	irq_module.register(irq_apu, aem.on_apu_irq)
	pietious_font.register_fonts()

	player_module.define_player_fsm()
	boekfoe_module.register()
	breakablewall_module.register()
	cloud_module.register()
	crossfoe_module.register()
	disappearingwall_module.register()
	marspeinenaardappel_module.register()
	mijterfoe_module.register()
	muziekfoe_module.register()
	nootfoe_module.register()
	paperfoe_module.register()
	stafffoe_module.register()
	staffspawn_module.register()
	vlokfoe_module.register()
	vlokspawner_module.register()
	zakfoe_module.register()
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
	init_epoch = init_epoch + 1
	pending_title_boot_epoch = init_epoch
end

*irq_mask_register = 0
init()
*irq_mask_register = vblank.irq_mask | irq_geo_done_error | irq_apu | gx_gpu.irq_mask
gx_texture.upload('pietolon_stand_r')
new_game()
vblank.wait()

-- Pietious intentionally advances one gameplay tick across two display frames.
while true do
	world:update()

	vblank.wait()
	world:render()
	vblank.wait()
end
