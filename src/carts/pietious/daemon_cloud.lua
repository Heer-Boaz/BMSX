local timeline = require('timeline')

local daemon_cloud = {}
daemon_cloud.__index = daemon_cloud

local anim_timeline_id = 'daemon_cloud.anim'

function daemon_cloud:ctor()
end

local function define_daemon_cloud_fsm()
	define_fsm('daemon_cloud', {
		initial = 'idle',
		on = {
			['daemon_cloud.play'] = '/playing',
		},
		states = {
			idle = {},
			playing = {
				timelines = {
					[anim_timeline_id] = {
						create = function()
							return timeline.new({
								id = anim_timeline_id,
								frames = timeline.build_frame_sequence({
									{ value = 'daemon_smoke_small', hold = 10 },
									{ value = 'daemon_smoke_large', hold = 10 },
									{ value = 'daemon_smoke_small', hold = 10 },
									{ value = 'daemon_smoke_large', hold = 10 },
								}),
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
				entering_state = function(self)
					self.visible = true
					self:gfx('daemon_smoke_small')
				end,
				on = {
					['timeline.frame.' .. anim_timeline_id] = {
						go = function(self)
							self:gfx(self:get_timeline(anim_timeline_id):value())
						end,
					},
					['timeline.end.' .. anim_timeline_id] = '/idle',
				},
				exiting_state = function(self)
					self.visible = false
					self:gfx('daemon_smoke_small')
				end,
			},
		},
	})
end

local function register_daemon_cloud_definition()
	define_prefab({
		def_id = 'daemon_cloud',
		class = daemon_cloud,
		type = 'sprite',
		fsms = { 'daemon_cloud' },
		defaults = {
			tick_enabled = true,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
