local timeline = require('timeline')

local daemon_cloud = {}
daemon_cloud.__index = daemon_cloud

local anim_timeline_id = 'daemon_cloud.anim'

function daemon_cloud:ctor()
end

local function define_daemon_cloud_fsm()
	define_fsm('daemon_cloud', {
		initial = 'playing',
		states = {
			playing = {
				timelines = {
					[anim_timeline_id] = {
						create = function()
							return timeline.new({
								id = anim_timeline_id,
								frames = timeline.build_frame_sequence({
								{ value = 'daemon_smoke_small', hold = 16 },
								{ value = 'daemon_smoke_large', hold = 16 },
								{ value = 'daemon_smoke_small', hold = 16 },
								{ value = 'daemon_smoke_large', hold = 16 },
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
						['timeline.frame.' .. anim_timeline_id] = function(self)
							self:gfx(self:get_timeline(anim_timeline_id):value())
						end,
						['timeline.end.' .. anim_timeline_id] = function(self)
							self:mark_for_disposal()
						end,
					},
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
			daemon_cloud_fx = true,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
