local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
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
	local drop_definition_id<const> = self.drop_definition_id
	if drop_definition_id ~= nil then
		world:spawn(drop_definition_id, {
			stage = self.stage,
			pos = { x = self.x, y = self.y },
		})
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
						def = {
							frames = frames,
							frame_duration = explosion_frame_ms,
							playback_mode = 'once',
							apply = sprite_object.set_imgid,
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
		components = {
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ machine_id }),
		},
		defaults = {
			imgid = frames[1],
			z = draw_z,
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
