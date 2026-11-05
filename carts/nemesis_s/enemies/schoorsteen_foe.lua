local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local sprite_component<const> = require('cartlib/component/sprite_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local ground_foe<const> = require('enemies/ground_foe')
local chimney_wreck<const> = require('effects/chimney_wreck')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local schoorsteen_foe<const> = {}
schoorsteen_foe.__index = schoorsteen_foe
setmetatable(schoorsteen_foe, { __index = ground_foe })

local fire_event<const> = 'schoorsteen.fire'
local closed_event<const> = 'schoorsteen.closed'
-- The same chamber remains luminous through charging, focusing and discharge.
local roof_opening<const> = {
	assets_schoorsteen_foe_1,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_3,
	assets_stadsburg_laser_fill,
	assets_stadsburg_laser_fill,
	assets_stadsburg_laser_pulse,
	assets_stadsburg_laser_charged,
	assets_stadsburg_laser_pulse,
	assets_stadsburg_laser_charged,
	assets_stadsburg_laser_pulse,
	assets_stadsburg_laser_pulse,
	assets_stadsburg_laser_charged,
	assets_stadsburg_laser_channel,
	assets_stadsburg_laser_channel,
}
local roof_closing<const> = {
	assets_stadsburg_laser_charged,
	assets_schoorsteen_foe_2,
	assets_schoorsteen_foe_1,
}
local quay_opening<const> = {
    'kade_idle', 'kade_idle', 'kade_idle', 'kade_fill', 'kade_fill',
    'kade_pulse', 'kade_charged', 'kade_pulse', 'kade_charged', 'kade_pulse',
    'kade_pulse', 'kade_charged', 'kade_channel', 'kade_channel',
}
local quay_closing<const> = { 'kade_charged', 'kade_fill', 'kade_idle' }
local players_view

function schoorsteen_foe:onspawn()
	if self.ray_direction == 1 then self:get_component(collider_2d_component):set_shape_flip(false,true) end
	if #players_view.objects == 2 then
		self.health = schoorsteen_foe_health * 2
	end
end

function schoorsteen_foe:enter_closed()
	self.vulnerable = false
	self.sprite_component:set_imgid(self.idle_image)
end

function schoorsteen_foe:update_idle()
	local pose_x<const> = self:get_global_position()
	if pose_x <= 0 then
		return
	end
	local players<const> = players_view.objects
	local fire_left<const> = pose_x + schoorsteen_foe_fire_left
	local fire_right<const> = pose_x + schoorsteen_foe_fire_right
	for player_index = 1, #players do
		local target_x<const> = players[player_index]:get_global_position()
		if target_x >= fire_left and target_x <= fire_right then
			return '/opening'
		end
	end
end

function schoorsteen_foe:finish_wait()
	return self:update_idle() or '/idle'
end

function schoorsteen_foe:enter_opening()
	self.vulnerable = true
end

function schoorsteen_foe:on_destroyed(projectile)
	chimney_wreck.spawn(self,self.ray_direction == 1)
	if self.ray_direction == -1 then
		local x<const>, y<const> = self:get_global_position()
		self:set_global_position(
			x - (large_explosion_size - self.body_width) // 2,
			y - (large_explosion_size - self.body_height) // 2)
	end
	ground_foe.on_destroyed(self, projectile)
end

function schoorsteen_foe:fire_ray()
	self.sprite_component:set_imgid(self.firing_image)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	self.scene:spawn(ids_schoorsteen_ray_def, {
		position = { x = pose_x + self.ray_origin_x, y = pose_y + self.ray_origin_y },
		stage = self.stage,
		direction = self.ray_direction,
	})
	self.events:emit('enemy.ray_fired')
	return '/firing'
end

local define_fsm<const> = function(fsm_id, opening_frames, closing_frames)
	fsm_library.register(fsm_id, {
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

local register_definition<const> = function(def_id, fsm_id, idle_image, firing_image, geometry)
	prefab.define({
		def_id = def_id,
		class = schoorsteen_foe,
		components = {
			enemy.collider_factory(geometry.collision),
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ fsm_id }),
		},
		defaults = {
			imgid = idle_image,
			order = schoorsteen_foe_draw_z,
			max_health = schoorsteen_foe_health,
			idle_image = idle_image, firing_image = firing_image,
			body_width = geometry.width, body_height = geometry.height,
			ray_direction = geometry.direction,
			ray_origin_x = (geometry.width - schoorsteen_ray_tile_size) // 2,
			ray_origin_y = geometry.ray_origin_y,
			small_fry = false,
			stage_scroll_width = geometry.width,
		},
	})
end

function schoorsteen_foe.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm(ids_schoorsteen_foe_fsm, roof_opening, roof_closing)
    define_fsm(ids_kadekanon_fsm, quay_opening, quay_closing)
	register_definition(ids_schoorsteen_foe_def, ids_schoorsteen_foe_fsm,
		assets_schoorsteen_foe_1, assets_stadsburg_laser_firing, {
			width = schoorsteen_foe_width, height = schoorsteen_foe_height,
			collision = assets.collision_shape_schoorsteen_foe_body_addr,
			direction = -1, ray_origin_y = schoorsteen_ray_offset_y,
		})
	register_definition(ids_kadekanon_def, ids_kadekanon_fsm, 'kade_idle', 'kade_firing', {
		width = kadekanon_width, height = kadekanon_height,
		collision = assets.collision_shape_kadekanon_body_addr,
		direction = 1, ray_origin_y = kadekanon_ray_offset_y,
	})
end

return schoorsteen_foe
