local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local ground_foe<const> = require('enemies/ground_foe')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local rook_generator<const> = {}
rook_generator.__index = rook_generator

local generation_started_event<const> = 'rook_generator.generation.started'
local spawn_event<const> = 'rook_generator.spawn'
local opening_frames<const> = timeline.build_frame_sequence({
	{ value = assets_rook_generator_open, hold = rook_generator_opening_updates },
})
local spawn_keys<const> = {}
for spawn_index = 1, rook_generator_spawn_count do
	spawn_keys[spawn_index] = {
		frame = (spawn_index - 1) * rook_generator_spawn_interval_updates,
		event = spawn_event,
		payload = rook_rise_distances[spawn_index],
		direction = 'forward',
	}
end
local players_view

function rook_generator:onspawn()
	if #players_view.objects == 2 then
		self.health = rook_generator_health * 2
	end
end

function rook_generator:enter_closed()
	self.vulnerable = false
	self:set_imgid(assets_rook_generator_closed)
end

function rook_generator:enter_generating()
	self.vulnerable = true
	self:set_imgid(assets_rook_generator_open)
end

function rook_generator:spawn_rook(_state, rise_distance)
	world:spawn(ids_rook_def, {
		stage = self.stage,
		rise_distance = rise_distance,
		pos = {
			x = self.x + rook_spawn_offset_x,
			y = self.y + rook_spawn_offset_y,
		},
	})
	self.events:emit('enemy.spawned')
end

function rook_generator:on_destroyed(projectile)
	self.x = self.x - 4
	self.y = self.y - 4
	ground_foe.on_destroyed(self, projectile)
end

local define_fsm<const> = function()
	fsm_library.register(ids_rook_generator_fsm, {
		initial = 'closed_wait',
		update = enemy.update_stage_follower,
		states = {
			closed_wait = {
				entering_state = rook_generator.enter_closed,
				timelines = {
					wait = {
						def = {
							continuous = true,
							duration_frames = rook_generator_initial_wait_updates,
							playback_mode = 'once',
						},
						play_options = { snap_to_start = false },
						on_finished = '/opening',
					},
				},
			},
			opening = {
				on = {
					[generation_started_event] = '/generating',
				},
				timelines = {
					open = {
						def = {
							frames = opening_frames,
							playback_mode = 'once',
							apply = rook_generator.set_imgid,
							tracks = {
								{
									kind = 'event',
									keys = {
										{
											frame = rook_generator_opening_updates - 1,
											event = generation_started_event,
											direction = 'forward',
										},
									},
								},
							},
						},
						play_options = { snap_to_start = false },
					},
				},
			},
			generating = {
				entering_state = rook_generator.enter_generating,
				on = {
					[spawn_event] = rook_generator.spawn_rook,
				},
				timelines = {
					formation = {
						def = {
							frames = timeline.range(rook_generator_cycle_updates),
							playback_mode = 'loop',
							tracks = {
								{
									kind = 'event',
									keys = spawn_keys,
								},
							},
						},
						play_options = { snap_to_start = false },
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_rook_generator_def,
		class = rook_generator,
		base = ground_foe,
		components = {
			enemy.collider_factory(assets.collision_shape_rook_generator_body_addr),
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_rook_generator_fsm }),
		},
		defaults = {
			imgid = assets_rook_generator_closed,
			max_health = rook_generator_health,
			small_fry = false,
			stage_scroll_width = rook_generator_width,
			z = rook_generator_draw_z,
		},
	})
end

function rook_generator.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return rook_generator
