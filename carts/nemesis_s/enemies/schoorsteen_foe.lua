local sprite_component<const> = require('cartlib/component/sprite_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local ground_foe<const> = require('enemies/ground_foe')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_foe<const> = {}
schoorsteen_foe.__index = schoorsteen_foe

local fire_event<const> = 'schoorsteen.fire'
local closed_event<const> = 'schoorsteen.closed'
local opening_frames<const> = timeline.build_frame_sequence({
	{ value = assets_schoorsteen_foe_1, hold = 1 },
	{ value = assets_schoorsteen_foe_2, hold = 1 },
	{ value = assets_schoorsteen_foe_3, hold = 1 },
	{ value = assets_schoorsteen_foe_4, hold = 2 },
	{ value = assets_schoorsteen_foe_5, hold = 1 },
	{ value = assets_schoorsteen_foe_4, hold = 1 },
	{ value = assets_schoorsteen_foe_5, hold = 1 },
	{ value = assets_schoorsteen_foe_4, hold = 1 },
	{ value = assets_schoorsteen_foe_5, hold = 3 },
	{ value = assets_schoorsteen_foe_4, hold = 2 },
})
local closing_frames<const> = {
	assets_schoorsteen_foe_3,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_1,
}
local new_flash_animation<const> = sprite_animation_component.factory({
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	loop = true,
	attachment_affine = { 1, 0, 0, 1, schoorsteen_flash_offset_x, schoorsteen_flash_offset_y },
	order = schoorsteen_foe_draw_z,
	enabled = false,
})
local players_view

function schoorsteen_foe:ctor()
	self.flash_animation = self:get_component(sprite_animation_component)
end

function schoorsteen_foe:onspawn()
	if #players_view.objects == 2 then
		self.health = schoorsteen_foe_health * 2
	end
end

function schoorsteen_foe:enter_closed()
	self.vulnerable = false
	self.flash_animation:deactivate()
	self.sprite_component:set_imgid(assets_schoorsteen_foe_1)
end

function schoorsteen_foe:update_idle()
	local pose<const> = self.spatial
	if pose.ox <= 0 then
		return
	end
	local players<const> = players_view.objects
	local fire_left<const> = pose.ox + schoorsteen_foe_fire_left
	local fire_right<const> = pose.ox + schoorsteen_foe_fire_right
	for player_index = 1, #players do
		local target<const> = players[player_index].spatial
		if target.ox >= fire_left and target.ox <= fire_right then
			return '/opening'
		end
	end
end

function schoorsteen_foe:finish_wait()
	return self:update_idle() or '/idle'
end

function schoorsteen_foe:enter_opening()
	self.vulnerable = true
	self.flash_animation:activate()
end

function schoorsteen_foe:fire_ray()
	local pose<const> = self.spatial
	self.scene:spawn(ids_schoorsteen_ray_def, {
		stage = self.stage,
	}, { local_transform = { 1, 0, 0, 1, pose.ox + schoorsteen_ray_offset_x, pose.oy + schoorsteen_ray_offset_y } })
	self.events:emit('enemy.ray_fired')
	return '/firing'
end

local define_fsm<const> = function()
	fsm_library.register(ids_schoorsteen_foe_fsm, {
		initial = 'startup',
		update = enemy.update_stage_follower,
		states = {
			startup = {
				entering_state = schoorsteen_foe.enter_closed,
				timelines = {
					startup_wait = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_frames = schoorsteen_foe_initial_wait_updates,
							playback_mode = 'once',
						},
						play_options = { snap_to_start = false },
						on_finished = schoorsteen_foe.finish_wait,
					},
				},
			},
			idle = {
				entering_state = schoorsteen_foe.enter_closed,
				update = schoorsteen_foe.update_idle,
			},
			opening = {
				entering_state = schoorsteen_foe.enter_opening,
				exiting_state = function(self)
					self.flash_animation:deactivate()
				end,
				on = {
					[fire_event] = schoorsteen_foe.fire_ray,
				},
				timelines = {
					open = {
						target_path = { 'sprite_component' },
						def = {
							phase = 'physical',
							frames = opening_frames,
							playback_mode = 'once',
							apply = sprite_component.set_imgid,
							tracks = {
								{
									kind = 'event',
									keys = {
										{
											frame = #opening_frames - 1,
											event = fire_event,
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
			firing = {
				timelines = {
					firing_wait = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_frames = schoorsteen_foe_firing_wait_updates,
							playback_mode = 'once',
						},
						play_options = { snap_to_start = false },
						on_finished = '/closing',
					},
				},
			},
			closing = {
				on = {
					[closed_event] = '/cooldown',
				},
				timelines = {
					close = {
						target_path = { 'sprite_component' },
						def = {
							phase = 'physical',
							frames = closing_frames,
							playback_mode = 'once',
							apply = sprite_component.set_imgid,
							tracks = {
								{
									kind = 'event',
									keys = {
										{
											frame = #closing_frames - 1,
											event = closed_event,
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
			cooldown = {
				timelines = {
					cooldown_wait = {
						def = {
							phase = 'physical',
							continuous = true,
							duration_frames = schoorsteen_foe_cooldown_updates,
							playback_mode = 'once',
						},
						play_options = { snap_to_start = false },
						on_finished = schoorsteen_foe.finish_wait,
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_schoorsteen_foe_def,
		class = schoorsteen_foe,
		base = ground_foe,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { imgid = assets_schoorsteen_foe_1, order = schoorsteen_foe_draw_z } },
		components = {
			enemy.collider_factory(assets.collision_shape_schoorsteen_foe_body_addr),
			new_flash_animation,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_schoorsteen_foe_fsm }),
		},
		defaults = {
			max_health = schoorsteen_foe_health,
			small_fry = false,
			stage_scroll_width = schoorsteen_foe_width,
		},
	})
end

function schoorsteen_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return schoorsteen_foe
