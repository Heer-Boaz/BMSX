local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/component')
local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/component')

local daemon_cloud<const> = {}
daemon_cloud.__index = daemon_cloud

local anim_timeline_id<const> = 'daemon_cloud.anim'

function daemon_cloud:ctor()
	self.visible = false
	self.collider:set_enabled(false)
end

function daemon_cloud:play_once_at(x, y)
	self.x = x
	self.y = y
	self:set_z(23)
	self.visible = true
	self:gfx('daemon_smoke_small')
	self.collider:set_enabled(true)
	self.timelines:play(anim_timeline_id, { rewind = true, snap_to_start = true })
end

function daemon_cloud:stop_and_hide()
	self.timelines:stop(anim_timeline_id)
	self.visible = false
	self.collider:set_enabled(false)
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
								{ value = 'daemon_smoke_small', hold = 16 },
								{ value = 'daemon_smoke_large', hold = 16 },
								{ value = 'daemon_smoke_small', hold = 16 },
								{ value = 'daemon_smoke_large', hold = 16 },
							}),
							playback_mode = 'once',
						},
						autoplay = false,
						stop_on_exit = true,
						on_frame = function(self)
							self:gfx(self.timelines:get(anim_timeline_id):value())
						end,
						on_end = function(self)
							self.visible = false
							self.collider:set_enabled(false)
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
		components = { timeline_component.new, state_machine_component.factory({ 'daemon_cloud' }) },
		defaults = {
			daemon_cloud_fx = true,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
