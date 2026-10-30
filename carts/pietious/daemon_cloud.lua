local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

local daemon_cloud<const> = {}
daemon_cloud.__index = daemon_cloud

local anim_timeline_id<const> = 'daemon_cloud.anim'
function daemon_cloud:ctor()
	self.play_options = { rewind = true, snap_to_start = true, target = self.sprite_component }
	self.sprite_component.visible = false
end

function daemon_cloud:play_once_at(x, y)
	self.spatial:set_world_origin(x, y)
	self.sprite_component.visible = true
	self.timelines:play(anim_timeline_id, self.play_options)
end

function daemon_cloud:stop_and_hide()
	self.timelines:stop(anim_timeline_id)
	self.sprite_component.visible = false
end

local define_daemon_cloud_fsm<const> = function()
	fsm_library.register('daemon_cloud', {
		initial = 'active',
		states = {
			active = {
				timelines = {
					[anim_timeline_id] = {
						def = {
							frames = timeline.build_frame_sequence({
								{ value = 'daemon_smoke_small', hold = 10 },
								{ value = 'daemon_smoke_large', hold = 10 },
								{ value = 'daemon_smoke_small', hold = 10 },
								{ value = 'daemon_smoke_large', hold = 10 },
							}),
							playback_mode = 'once',
							phase = 'presentation',
							apply = sprite_component.set_imgid,
						},
						autoplay = false,
						stop_on_exit = true,
						on_finished = function(self)
							self.sprite_component.visible = false
						end,
					},
				},
			},
		},
	})
end

local register_daemon_cloud_definition<const> = function()
	prefab.define({
		def_id = 'daemon_cloud',
		class = daemon_cloud,
		base = sprite_object,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 23 } },
		components = { timeline_component.new, fsm_component.factory({ 'daemon_cloud' }) },
		defaults = {
			daemon_cloud_fx = true,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
