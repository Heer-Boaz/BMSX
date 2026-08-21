local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')

local selected_apu_source<const>: *word = 0x0800018c
local ray_audio_source<const> = rom_dir.audio('nemesis2_foe_laser').addr

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 20, 'Nemesis S visual-component scenario timed out')

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'spawn' then
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local snowman<const> = world:spawn(ids_sneeuwpop_def, {
			stage = stage,
			pos = { x = 100, y = 48 },
		})
		local animation<const> = snowman:get_component(sprite_animation_component)
		assert(not animation.enabled,
			'the dormant flash animation entered retained render or tick storage')
		snowman.state_machines:transition_to('/ready_to_fire')
		assert(animation.enabled and animation.frame_index == 1,
			'flash activation did not restart and admit its animated sprite')
		test.snowman = snowman
		test.animation = animation
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'animation'
		return false
	end

	if test.phase == 'animation' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		assert(test.animation.frame_index == 2,
			'the retained sprite-animation lane did not advance one frame')
		test.snowman.state_machines:transition_to('/firing')
		assert(not test.animation.enabled,
			'leaving the flash state did not retire its visual and tick work')

		test.snowman:fire_ray()
		assert(*selected_apu_source == ray_audio_source,
			'Sneeuwpop firing did not emit its XNA ray cue')
		local ray<const> = test.snowman.ray
		local strip<const> = ray:get_component(tile_strip_component)
		assert(ray.top_y == nil,
			'the ray still shadows derived strip geometry on its world object')
		ray:apply_expansion_frame(sneeuwpop_ray_max_steps - 1)
		local x<const> = ray.x
		local y<const> = ray.y
		local first_tile<const> = strip.first_tile
		ray:apply_contraction_frame(1)
		assert(strip.first_tile == first_tile + sneeuwpop_ray_growth_tiles,
			'ray contraction did not trim its retained tile range')
		assert(ray.x == x and ray.y == y,
			'ray contraction mutated world position to encode visual geometry')
		return true
	end

	return false
end
