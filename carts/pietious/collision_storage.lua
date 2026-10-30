-- Pietious owns bounded retained collision output storage. Source geometry is
-- measured once from this cart's actual ROM bindings, never from live visuals.
local pool<const> = require('cartlib/collision/geometry_pool')
local sprite_shape<const> = require('cartlib/collision/sprite_shape')
local shape<const> = require('cartlib/collision/collision_shape')
local assets<const> = require('bmsx/assets')

local sprite_sources<const> = {
	'pietolon_stand_r', 'pietolon_walk_r', 'pietolon_jump_r', 'sword_r',
	'pietolon_hit_r', 'pietolon_slash_r', 'pietolon_jumpslash_r',
	'pietolon_stairs_up_1', 'pietolon_stairs_up_2',
	'pietolon_stairs_down_1', 'pietolon_stairs_down_2',
	'pietolon_pause_seated', 'pietolon_pause_stuck_1', 'pietolon_pause_stuck_2',
	'pietolon_recover_r', 'pietolon_dying_1', 'pietolon_dying_2',
	'pietolon_dying_3', 'pietolon_dying_4', 'pietolon_dying_5',
	'boekfoe_closed', 'boekfoe_open',
	'boekfoe_paper', 'cloud_1', 'cloud_2', 'crossfoe', 'crossfoe_turned',
	'marspeinenaardappel', 'meijter_r', 'meijter_dr', 'meijter_up',
	'muziekfoe', 'muzieknootfoe', 'stafffoe', 'staffspawn', 'vlok',
	'zakfoe_stand', 'zakfoe_jump', 'zakfoe_recover', 'stone', 'stone_broken',
	'ammo', 'item_health', 'world_key', 'map', 'halo', 'pepernoot_16',
	'spyglass', 'item_lamp', 'schoentjes', 'item_greenvase', 'elevator_platform',
}
local sprite_slot_bytes = 0
for index = 1, #sprite_sources do
	local bytes<const> = sprite_shape.image(sprite_sources[index]).bytes
	if bytes > sprite_slot_bytes then sprite_slot_bytes = bytes end
end
local boss_sources<const> = {
	assets.collision_shape_world1_daemon_walk_1_body_addr,
	assets.collision_shape_world1_daemon_walk_2_body_addr,
	assets.collision_shape_world1_daemon_spawn_prepare_1_body_addr,
	assets.collision_shape_world1_daemon_spawn_prepare_2_body_addr,
	assets.collision_shape_world1_daemon_pounce_prepare_1_body_addr,
	assets.collision_shape_world1_daemon_pounce_prepare_2_body_addr,
	assets.collision_shape_world1_daemon_pounce_body_addr,
}
local boss_slot_bytes = 0
for index = 1, #boss_sources do
	local bytes<const> = shape.bind(boss_sources[index]).bytes
	if bytes > boss_slot_bytes then boss_slot_bytes = bytes end
end

bss sprite_geometry: word[16384]
bss area_geometry: word[4096]
bss boss_geometry: word[4096]

return {
	sprite = pool.new(sprite_geometry, sprite_slot_bytes, 65536 // sprite_slot_bytes),
	area = pool.new(area_geometry, 64, 256),
	boss = pool.new(boss_geometry, boss_slot_bytes, 16384 // boss_slot_bytes),
}
