local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local sprite_object<const> = require('cartlib/sprite')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local explosion<const> = {}
explosion.__index = explosion

local small_frames<const> = {
	assets_small_explosion_1,
	assets_small_explosion_2,
	assets_small_explosion_3,
	assets_small_explosion_4,
}
local large_frames<const> = {
	assets_large_explosion_1,
	assets_large_explosion_2,
	assets_large_explosion_3,
}

function explosion:finish()
	local pose<const> = self.spatial
	local drop_definition_id<const> = self.drop_definition_id
	if drop_definition_id ~= nil then
		self.scene:spawn(drop_definition_id, {
			stage = self.stage,
		}, { local_transform = { 1, 0, 0, 1, pose.ox, pose.oy } })
	end
	self:mark_for_disposal()
end

local register_variant<const> = function(definition_id, machine_id, frames, draw_z)
	fsm_library.register(machine_id, {
		initial = 'playing',
		states = {
			playing = {
				timelines = {
					animation = {
						target_path = { 'sprite_component' },
						def = {
							phase = 'presentation',
							frames = frames,
							frame_duration = explosion_frame_ms,
							playback_mode = 'once',
							apply = sprite_component.set_imgid,
						},
						on_finished = explosion.finish,
					},
				},
			},
		},
	})
	prefab.define({
		def_id = definition_id,
		class = explosion,
		base = sprite_object,
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ machine_id }),
		},
		defaults = {
			imgid = frames[1],
			order = draw_z,
		},
	})
end

function explosion.register()
	register_variant(
		ids_small_explosion_def,
		ids_small_explosion_fsm,
		small_frames,
		small_explosion_draw_z
	)
	register_variant(
		ids_large_explosion_def,
		ids_large_explosion_fsm,
		large_frames,
		large_explosion_draw_z
	)
end

return explosion
