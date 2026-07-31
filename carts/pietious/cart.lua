module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_image<const> = require('cartlib/gx/image')
local gx_texture<const> = require('cartlib/gx/texture')
local texture_layout<const> = require('bmsx/gx_texture_layout')
gx_gpu.reset_256x192()
local aem<const> = require('cartlib/aem')
local collision2d<const> = require('cartlib/collision2d')
local ecs_pipeline_registry<const> = require('cartlib/ecs/pipeline').defaultecspipelineregistry
local behaviour_tree_system<const> = require('cartlib/ecs/systems/behaviour_tree')
local boundary_system<const> = require('cartlib/ecs/systems/boundary')
local object_fsm_system<const> = require('cartlib/ecs/systems/object_fsm')
local overlap_2d_system<const> = require('cartlib/ecs/systems/overlap_2d')
local previous_position_system<const> = require('cartlib/ecs/systems/previous_position')
local tile_collision_system<const> = require('cartlib/ecs/systems/tile_collision')
local timeline_system<const> = require('cartlib/ecs/systems/timeline')
local visual_render_system<const> = require('cartlib/ecs/systems/visual_render')
local input_action_effect_system<const> = require('cartlib/input/action_effect/system')
local cart_input<const> = require('cartlib/input/player')
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch
local prefab<const> = require('cartlib/prefab')
local world_instance<const> = require('cartlib/world/index').instance
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

local pipeline_descriptors<const> = {
	previous_position_system,
	behaviour_tree_system,
	input_action_effect_system,
	object_fsm_system,
	boundary_system,
	overlap_2d_system,
	tile_collision_system,
	timeline_system,
	visual_render_system,
	elevator_update_system_module,
}
local pietious_pipeline_spec<const> = {
	{ ref = previous_position_system.id },
	{ ref = behaviour_tree_system.id },
	{ ref = input_action_effect_system.id },
	{ ref = object_fsm_system.id },
	{ ref = elevator_update_system_module.id },
	{ ref = boundary_system.id },
	{ ref = overlap_2d_system.id },
	{ ref = tile_collision_system.id },
	{ ref = timeline_system.id },
	{ ref = visual_render_system.id },
}

local init_epoch = 0
local pending_title_boot_epoch = -1

local irq_mask_addr<const> = 0x08000008
local irq_vblank<const> = 0x0004
local irq_geo_done_error<const> = 0x0018
local irq_apu<const> = 0x0020
local irq_gpu<const> = 0x0040
local framebuffer_front<const> = texture_layout.framebuffer_front
local framebuffer_back<const> = texture_layout.framebuffer_back
local vblank_sequence = 0
local gpu_completion_sequence = 0
local front_framebuffer = framebuffer_front
local back_framebuffer = framebuffer_back

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

local wait_vblank_after<const> = function(sequence)
	while vblank_sequence == sequence do
		halt_until_irq
	end
end

local wait_gpu_after<const> = function(sequence)
	while gpu_completion_sequence == sequence do
		halt_until_irq
	end
end

local grant_starting_loadout<const> = function()
	local player<const> = world_instance:get('pietolon')
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
	local castle<const> = world_instance:get('c')
	progression.set(castle, 'staff1destroyed', true)
	progression.set(castle, 'staff2destroyed', true)
	progression.set(castle, 'staff3destroyed', true)
end

local create_world<const> = function(director_boot_mode)
	world_instance:clear()
	ecs_pipeline_registry:build(world_instance, pietious_pipeline_spec)
	world_instance:add_space('main')
	world_instance:add_space('title')
	world_instance:add_space('transition')
	world_instance:add_space('shrine')
	world_instance:add_space('lithograph')
	world_instance:add_space('item')
	world_instance:add_space('ui')
	world_instance:set_space('main')

	local c<const> = prefab.spawn('castle', { id = 'c', })

	prefab.spawn('room', { id = 'room', })

	prefab.spawn('player', {
		id = 'pietolon',
		pos = { x = player_start_x, y = player_start_y, z = 140 },
	})
	grant_starting_loadout()
	c:initialize(castle_map.start_room_number, director_boot_mode ~= 'title_screen')

	prefab.spawn('transition', { id = 'transition', space_id = 'transition', })
	prefab.spawn('shrine', { id = 'shrine', space_id = 'shrine', })
	prefab.spawn('lithograph_screen', { id = 'lithograph', space_id = 'lithograph', })
	prefab.spawn('item_screen', { id = 'item_screen', space_id = 'item', })
	prefab.spawn('ui', { id = 'ui', pos = { z = draw_z_hud }, })
	prefab.spawn('title_screen', { id = 'title_screen', space_id = 'title', })
	prefab.spawn('director', { id = 'd', boot_mode = director_boot_mode, pos = { z = draw_z_director_effect }, })
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
	ecs_pipeline_registry:register_many(pipeline_descriptors)
	irq_module.register(irq_geo_done_error, collision2d.on_geo_irq)
	irq_module.register(irq_apu, aem.on_apu_irq)
	irq_module.register(irq_vblank, function()
		vblank_sequence = vblank_sequence + 1
	end)
	irq_module.register(irq_gpu, function()
		gx_gpu.ack_irq()
		gpu_completion_sequence = gpu_completion_sequence + 1
	end)
	aem.reload()
	gx_gpu.draw_target(framebuffer_front)
	gx_gpu.clear_color(0xff000000)
	gx_gpu.draw_target(framebuffer_back)
	gx_gpu.clear_color(0xff000000)
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
mem[irq_mask_addr] = 0
init()
gx_texture.upload(gx_image.rect('pietolon_stand_r').texture, texture_layout.gameplay, texture_layout.gameplay_clut)
mem[irq_mask_addr] = irq_vblank | irq_geo_done_error | irq_apu | irq_gpu
new_game()
mem[0x08000064] = 0x00000001
wait_vblank_after(vblank_sequence)

while true do
	cart_input.update()
	world_instance:update()

	wait_vblank_after(vblank_sequence)
	gx_gpu.clear_color(0xff000000)
	world_instance:draw()
	local completion_sequence<const> = gpu_completion_sequence
	gx_gpu.request_irq()
	wait_gpu_after(completion_sequence)

	mem[0x08000064] = 0x00000001
	gx_gpu.display_origin(back_framebuffer)
	local flip_vblank_sequence<const> = vblank_sequence
	wait_vblank_after(flip_vblank_sequence)
	front_framebuffer, back_framebuffer = back_framebuffer, front_framebuffer
	gx_gpu.draw_target(back_framebuffer)
end
