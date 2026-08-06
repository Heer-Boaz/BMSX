local fsmlibrary<const> = require('cartlib/fsm/library')
local fsmcomponent<const> = require('cartlib/fsm/fsmcomponent')
local prefab<const> = require('cartlib/world/prefab')
local spriteobject<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timelinecomponent<const> = require('cartlib/timeline/timelinecomponent')

local daemon_cloud<const> = {}
daemon_cloud.__index = daemon_cloud

local anim_timelineid<const> = 'daemon_cloud.anim'

function daemon_cloud:ctor()
	self.visible = false
	self.collider:set_enabled(false)
end

function daemon_cloud:play_once_at(x, y)
	self.x = x
	self.y = y
	self:set_z(23)
	self.visible = true
	self:set_imgid('daemon_smoke_small')
	self.collider:set_enabled(true)
	self.timelines:play(anim_timelineid, { rewind = true, snap_to_start = true })
end

function daemon_cloud:stop_and_hide()
	self.timelines:stop(anim_timelineid)
	self.visible = false
	self.collider:set_enabled(false)
end

local define_daemon_cloud_fsm<const> = function()
	fsmlibrary.register('daemon_cloud', {
		initial = 'active',
		states = {
			active = {
				timelines = {
					[anim_timelineid] = {
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
							self:set_imgid(self.timelines:get(anim_timelineid):value())
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
		base = spriteobject,
		components = { timelinecomponent.new, fsmcomponent.factory({ 'daemon_cloud' }) },
		defaults = {
			daemon_cloud_fx = true,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
