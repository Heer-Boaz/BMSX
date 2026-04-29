local constants<const> = require('constants')
local enemy_registry<const> = require('enemy/registry')
local progression<const> = require('bios/progression')
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
local collision_profiles<const> = require('bios/collision_profiles')
local castle_map<const> = require('castle/map')

local init_epoch = 0
local pending_title_boot_epoch = -1

local register_collision_profiles<const> = function()
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

local dispatch_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
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
	oget('pietolon').weapon_level = constants.hud.weapon_level
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
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = 140 },
	})
	grant_starting_loadout()
	c:initialize(castle_map.start_room_number, director_boot_mode ~= 'title_screen')

	inst('transition', { id = 'transition', space_id = 'transition', })
	inst('shrine', { id = 'shrine', space_id = 'shrine', })
	inst('lithograph_screen', { id = 'lithograph', space_id = 'lithograph', })
	inst('item_screen', { id = 'item_screen', space_id = 'item', })
	inst('ui', { id = 'ui', })
	inst('title_screen', { id = 'title_screen', space_id = 'title', })
	inst('director', { id = 'd', boot_mode = director_boot_mode, })
end

local new_game<const> = function()
	mem[sys_inp_player] = 1
	if pending_title_boot_epoch == init_epoch then
		pending_title_boot_epoch = init_epoch - 1
		create_world('title_screen')
		return
	end
	create_world('room')
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
	vdp_load_slot(sys_vdp_slot_primary, 0)
	init_epoch = init_epoch + 1
	pending_title_boot_epoch = init_epoch
end

-- Pietious owns the hardware cadence explicitly. Input is armed before the
-- VBLANK that samples it, game logic runs during the following visible frame,
-- rendering/DMA happens in the next VBLANK, and the extra wait keeps the game
-- tick at half the display refresh rate.
mem[sys_inp_ctrl] = inp_ctrl_arm
local flags
repeat
	halt_until_irq
	flags = dispatch_irqs()
until (flags & irq_vblank) ~= 0

while true do
	update_world()

	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
	vdp_stream_cursor = sys_vdp_stream_base
	draw_world()
	mem[sys_dma_src] = sys_vdp_stream_base
	mem[sys_dma_dst] = sys_vdp_fifo
	mem[sys_dma_len] = vdp_stream_cursor - sys_vdp_stream_base
	mem[sys_dma_ctrl] = dma_ctrl_start

	mem[sys_inp_ctrl] = inp_ctrl_arm
	print('test')
	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
end
