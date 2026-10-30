-- Cart-owned retained collision storage. Area/projectile slots are exact
-- four-vertex outputs; packed actor slots use this cart's actual source bound.
local pool<const> = require('cartlib/collision/geometry_pool')
local sprite_shape<const> = require('cartlib/collision/sprite_shape')
local shape<const> = require('cartlib/collision/collision_shape')
local assets<const> = require('bmsx/assets')
require('constants')

local actor_sources<const> = {
	assets.collision_shape_bel_middle_body_addr,
	assets.collision_shape_bel_side_body_addr,
	assets.collision_shape_moon_down_armor_addr,
	assets.collision_shape_moon_down_core_addr,
	assets.collision_shape_moon_down_left_armor_addr,
	assets.collision_shape_moon_down_left_core_addr,
	assets.collision_shape_moon_down_right_armor_addr,
	assets.collision_shape_moon_down_right_core_addr,
	assets.collision_shape_moon_left_armor_addr,
	assets.collision_shape_moon_left_core_addr,
	assets.collision_shape_moon_right_armor_addr,
	assets.collision_shape_moon_right_core_addr,
	assets.collision_shape_moon_up_armor_addr,
	assets.collision_shape_moon_up_core_addr,
	assets.collision_shape_moon_up_left_armor_addr,
	assets.collision_shape_moon_up_left_core_addr,
	assets.collision_shape_moon_up_right_armor_addr,
	assets.collision_shape_moon_up_right_core_addr,
	assets.collision_shape_rook_generator_body_addr,
	assets.collision_shape_schoorsteen_foe_body_addr,
	assets.collision_shape_sneeuwpop_body_addr,
	assets.collision_shape_sneeuwpop_destroyed_body_addr,
}
local actor_slot_bytes = 0
for index = 1, #actor_sources do
	local bytes<const> = shape.bind(actor_sources[index]).bytes
	if bytes > actor_slot_bytes then actor_slot_bytes = bytes end
end

local sprite_slot_bytes<const> = sprite_shape.image(assets_enemy_bullet).bytes
bss sprite_geometry: word[4096]
bss area_geometry: word[4096]
bss actor_geometry: word[16384]
local diagonal_slot_bytes<const> = 32 + (sneeuwpop_ray_max_steps - 1) * sneeuwpop_ray_growth_tiles * 64
bss diagonal_geometry: word[4096]

return {
	sprite = pool.new(sprite_geometry, sprite_slot_bytes, 16384 // sprite_slot_bytes),
	area = pool.new(area_geometry, 64, 256),
	actor = pool.new(actor_geometry, actor_slot_bytes, 65536 // actor_slot_bytes),
	diagonal = pool.new(diagonal_geometry, diagonal_slot_bytes, 16384 // diagonal_slot_bytes),
}
