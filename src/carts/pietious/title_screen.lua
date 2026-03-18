local constants = require('constants')

local title_screen = {}
title_screen.__index = title_screen

local sparkle_timeline_id = 'title_screen.sparkle'
local start_timeline_id = 'title_screen.start'

local title_exit_events = {
	'room',
	'transition',
	'halo',
	'shrine',
	'item',
	'lithograph',
	'story',
	'ending',
	'victory_dance',
	'death',
	'seal_dissolution',
	'daemon_appearance',
}

local sparkle_steps = {
	{ x = 76, y = 67, sprite_id = 'ts_fairy_star_1' },
	{ x = 86, y = 67, sprite_id = 'ts_fairy_star_2' },
	{ x = 96, y = 66, sprite_id = 'ts_fairy_star_1' },
	{ x = 106, y = 66, sprite_id = 'ts_fairy_star_2' },
	{ x = 116, y = 65, sprite_id = 'ts_fairy_star_1' },
	{ x = 126, y = 65, sprite_id = 'ts_fairy_star_2' },
	{ x = 136, y = 64, sprite_id = 'ts_fairy_star_1' },
	{ x = 146, y = 64, sprite_id = 'ts_fairy_star_2' },
}

local function build_title_sparkle_frames()
	local frames = {
		{
			value = { visible = false },
			hold = 48,
		},
	}
	for i = 1, #sparkle_steps do
		local step = sparkle_steps[i]
		frames[#frames + 1] = {
			value = {
				visible = true,
				x = step.x,
				y = step.y,
				sprite_id = step.sprite_id,
			},
			hold = 4,
		}
	end
	frames[#frames + 1] = {
		value = { visible = false },
		hold = 40,
	}
	return timeline.build_frame_sequence(frames)
end

local function build_title_start_frames()
	local frames = {}
	for _ = 1, constants.flow.title_start_blink_cycles do
		frames[#frames + 1] = {
			value = { sprite_id = 'title_screen_play_start' },
			hold = constants.flow.title_start_blink_phase_frames,
		}
		frames[#frames + 1] = {
			value = { sprite_id = 'title_screen_play_start_blink' },
			hold = constants.flow.title_start_blink_phase_frames,
		}
	end
	frames[#frames + 1] = {
		value = { sprite_id = 'title_screen_play_start' },
		hold = constants.flow.title_start_blink_phase_frames,
	}
	frames[#frames + 1] = {
		value = { sprite_id = 'title_screen_play_start_blink' },
		hold = constants.flow.title_start_blink_tail_frames,
	}
	return timeline.build_frame_sequence(frames)
end

function title_screen:bind_visual()
	self:get_component('customvisualcomponent').producer = function()
		self:render_sparkle()
	end
end

function title_screen:set_sparkle(frame)
	self.sparkle_visible = frame.visible
	self.sparkle_x = frame.x
	self.sparkle_y = frame.y
	self.sparkle_sprite_id = frame.sprite_id
end

function title_screen:clear_sparkle()
	self.sparkle_visible = false
	self.sparkle_x = 0
	self.sparkle_y = 0
	self.sparkle_sprite_id = 'ts_fairy_star_1'
end

function title_screen:render_sparkle()
	if not self.visible or not self.sparkle_visible then
		return
	end
	put_sprite(self.sparkle_sprite_id, self.sparkle_x, self.sparkle_y, self.z + 1)
end

function title_screen:ctor()
	self.collider.enabled = false
	self:clear_sparkle()
	self:bind_visual()
end

local function build_title_root_on(show_path)
	local on = {
		['title'] = {
			emitter = 'd',
			go = show_path,
		},
	}
	for i = 1, #title_exit_events do
		local event_name = title_exit_events[i]
		on[event_name] = {
			emitter = 'd',
			go = '/hidden',
		}
	end
	return on
end

local function define_title_screen_fsm()
	define_fsm('title_screen', {
		initial = 'hidden',
		on = build_title_root_on('/idle'),
		states = {
			hidden = {
				entering_state = function(self)
					self.visible = false
					self:clear_sparkle()
					self:gfx('title_screen')
				end,
			},
			idle = {
				entering_state = function(self)
					self.visible = true
					self:clear_sparkle()
					self:gfx('title_screen')
				end,
				timelines = {
					[sparkle_timeline_id] = {
						def = {
							frames = build_title_sparkle_frames(),
							playback_mode = 'loop',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_frame = function(self)
							self:set_sparkle(self:get_timeline(sparkle_timeline_id):value())
						end,
					},
				},
				input_event_handlers = {
					['start[jp] || a[jp]'] = function(self)
						self.events:emit('title_start')
						return '/starting'
					end,
				},
			},
			starting = {
				entering_state = function(self)
					self.visible = true
					self:clear_sparkle()
					self:gfx('title_screen_play_start')
				end,
				timelines = {
					[start_timeline_id] = {
						def = {
							frames = build_title_start_frames(),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_frame = function(self)
							self:gfx(self:get_timeline(start_timeline_id):value().sprite_id)
						end,
						on_end = function(self)
							self.events:emit('title_screen_done')
							return '/hidden'
						end,
					},
				},
			},
		},
	})
end

local function register_title_screen_definition()
	define_prefab({
		def_id = 'title_screen',
		class = title_screen,
		type = 'sprite',
		components = { 'customvisualcomponent' },
		fsms = { 'title_screen' },
		defaults = {
			imgid = 'title_screen',
			visible = false,
			z = 350,
		},
	})
end

return {
	define_title_screen_fsm = define_title_screen_fsm,
	register_title_screen_definition = register_title_screen_definition,
}
