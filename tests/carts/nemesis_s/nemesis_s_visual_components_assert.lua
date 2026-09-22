local fixture<const> = require('tests/carts/nemesis_s/fixture')
local test<const> = {}
local clock<const> = require('cartlib/clock')

local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')

local sprite_component<const> = require('cartlib/component/sprite_component')

local tile_strip_component<const> = require('cartlib/component/tile_strip_component')

local registry<const> = require('cartlib/registry')

local rom_dir<const> = require('cartlib/rom_dir')

local world<const> = require('cartlib/world/world')

require('constants')

local selected_apu_source<const>: *word = 0x0800018c

local ray_audio_source<const> = rom_dir.audio('nemesis2_foe_laser').addr

return {
	kind = 'integration',
	tests = {
		visual_components = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t)

			do
				stage.actor_spawn_index = stage.actor_spawn_count + 1
				local snowman<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_sneeuwpop_def, {
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
				t:wait_ticks(1)
			end
			do
				t:wait_until('flash gameplay update', function() return world.gameplay_time_ms ~= test.gameplay_time_ms end, 120)
				t:at_boundary(world:request_mutation_boundary(), 30)
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
				local rook<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_rook_def, {
					stage = stage,
					rise_distance = 0,
					pos = { x = 240, y = 112 },
				})
				local rook_animation<const> = rook:get_component(sprite_animation_component)
				assert(rook.sprite_component == rook_animation
				and #rook._components_by_class[sprite_component] == 1,
				'Rook retained a shadow base sprite beside its primary animation')
				assert(rook_animation.frame_duration_ms
				== rook_animation_frame_updates * clock.gameplay_delta_milliseconds(),
				'Rook animation changed from its four-update actor cadence')
				assert(rook.motion.velocity_x == 0
				and rook.motion.velocity_y == rook_rise_velocity_y_q8,
				'Rook admission lost its raw Nemesis 2 rise velocity')
				local player<const> = registry:get('nemesis_s.player.1')
				local player_x<const> = player.x
				local player_y<const> = player.y
				player.x = rook.x - 1
				rook:update_leaving_chimney()
				assert(rook.motion.velocity_x == -rook_attack_velocity_x_q8
				and rook.motion.velocity_y == 0
				and not rook.stage_scroll_follower.enabled,
				'Rook launch lost its raw horizontal velocity or stage detachment')
				player.y = rook.y - 1
				rook:update_attacking_player()
				assert(rook.motion.velocity_y == -rook_tracking_acceleration_y_q8,
				'Rook did not accelerate upward toward its retained target')
				player.y = rook.y + 1
				rook:update_attacking_player()
				assert(rook.motion.velocity_y == 0,
				'Rook did not add the raw downward tracking acceleration')
				player.x = player_x
				player.y = player_y
			end
		end,
	},
}
