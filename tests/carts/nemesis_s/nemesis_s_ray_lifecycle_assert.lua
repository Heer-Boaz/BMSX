local fixture<const> = require('tests/carts/nemesis_s/fixture')
local test<const> = {}
local clock<const> = require('cartlib/clock')

local tile_strip_component<const> = require('cartlib/component/tile_strip_component')

local registry<const> = require('cartlib/registry')

local world<const> = require('cartlib/world/world')

require('constants')

local probe_ray_tiles<const> = 9

local probe_contraction_updates<const> = (probe_ray_tiles - 1)
// schoorsteen_ray_growth_tiles + 1

local probe_lifetime_updates<const> = schoorsteen_ray_growth_updates
+ probe_contraction_updates

return {
	kind = 'integration',
	tests = {
		ray_lifecycle = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t)
			test.players = world:active_definition_view(ids_player_def)
			do
				stage.scrolling = false
				stage.actor_spawn_index = stage.actor_spawn_count + 1
				local chimney<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_schoorsteen_foe_def, {
					stage = stage,
					pos = { x = 120, y = 88 },
				})
				local player<const> = registry:get('nemesis_s.player.1')
				local player_x<const> = player.x
				player.x = chimney.x - 33
				assert(chimney:update_idle() == nil,
				'chimney admitted a player left of its Nemesis 2 scan window')
				player.x = chimney.x - 32
				assert(chimney:update_idle() == '/opening',
				'chimney rejected the left edge of its Nemesis 2 scan window')
				player.x = chimney.x + 31
				assert(chimney:update_idle() == '/opening',
				'chimney rejected the right edge of its Nemesis 2 scan window')
				player.x = chimney.x + 32
				assert(chimney:update_idle() == nil,
				'chimney admitted a player right of its Nemesis 2 scan window')
				player.x = player_x
				chimney.state_machines:transition_to('/firing')
				chimney:fire_ray()
				local firing<const> = chimney.state_machines:bind_state_path('/firing')
				local chimney_ray<const> = world:active_definition_view(ids_schoorsteen_ray_def).objects[1]
				chimney_ray:mark_for_disposal()
				assert(chimney.state_machines:matches_state(firing),
				'chimney lifetime remained coupled to its independently retained ray')
				local probe_stage<const> = {
					first_solid_vertical_tile_offset = function(_self, x, y, count, direction)
						assert(x == 48 and y == 72 and count == 41 and direction == -1,
						'chimney ray did not submit its exact upward tile run')
						return probe_ray_tiles
					end,
				}
				local bounded_ray<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_schoorsteen_ray_def, {
					stage = probe_stage,
					pos = { x = 48, y = 80 },
				})
				local strip<const> = bounded_ray:get_component(tile_strip_component)
				assert(strip.first_tile == 1 and strip.last_tile == 1,
				'chimney ray lost its one-tile admission length')
				bounded_ray:apply_expansion_frame(0)
				assert(strip.last_tile == 5,
				'chimney ray did not expand by four tiles on one actor update')
				bounded_ray:apply_expansion_frame(1)
				bounded_ray:apply_expansion_frame(9)
				assert(strip.last_tile == 9,
				'chimney ray crossed the retained solid-tile boundary')
				bounded_ray:apply_contraction_frame(0)
				assert(strip.first_tile == 5,
				'chimney ray contraction did not trim four emitter-side tiles')
				bounded_ray:apply_contraction_frame(1)
				assert(strip.first_tile == 9,
				'chimney ray contraction moved its retained far endpoint')
				bounded_ray:apply_contraction_frame(2)
				assert(registry:get(bounded_ray.id) == nil,
				'empty chimney ray remained published')
				local timed_ray<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_schoorsteen_ray_def, {
					stage = probe_stage,
					pos = { x = 48, y = 80 },
				})
				local snowman<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_sneeuwpop_def, {
					stage = stage,
					pos = { x = 160, y = 48 },
				})
				snowman.state_machines:transition_to('/firing')
				snowman:fire_ray()
				local detached_ray<const> = snowman.ray
				snowman:on_destroyed()
				assert(registry:get(snowman.id) == nil,
				'destroyed snowman remained published')
				assert(registry:get(detached_ray.id) == detached_ray,
				'destroying a snowman erased its independently retained ray')
				detached_ray:finish()
				assert(registry:get(detached_ray.id) == nil,
				'detached snowman ray did not finish its own lifecycle')
				test.chimney = chimney
				test.firing_state = firing
				test.fired_at_ms = world.gameplay_time_ms
				test.timed_ray = timed_ray
				test.ray_started_at_ms = world.gameplay_time_ms
				t:wait_ticks(1)
			end
			do
				t:wait_until('ray_lifecycle observation 1', function() return not (test.chimney.state_machines:matches_state(test.firing_state)) end, 120)
				assert(world.gameplay_time_ms - test.fired_at_ms
				== schoorsteen_foe_firing_wait_updates * clock.gameplay_delta_milliseconds(),
				'chimney firing hold changed from its Nemesis 2 actor cadence')
			end
			t:wait_until('ray_lifecycle observation 2', function() return not (registry:get(test.timed_ray.id) ~= nil) end, 120)
			assert(world.gameplay_time_ms - test.ray_started_at_ms
			== probe_lifetime_updates * clock.gameplay_delta_milliseconds(),
			'terrain clamp shortened the ray expansion cadence')
		end,
	},
}
