local constants = require('constants')

local title_screen = {}
title_screen.__index = title_screen

local hidden_space_id = 'ui'
local title_space_id = 'transition'
local sparkle_timeline_id = 'title_screen.sparkle'
local idle_timeline_id = 'title_screen.idle'
local start_timeline_id = 'title_screen.start'

local title_exit_events = {
	'title_wait',
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

local sparkle_static = { sprite_id = 'tsf_static', x = 88, y = 31 }

local sparkle_sweep_sprite_ids = {
	'tsf4',
	'tsf5',
	'tsf6',
	'tsf7',
}

local sparkle_sweep_frame_x = {
	110,
	124,
	138,
}

local sparkle_sweep_start_x = 96
local sparkle_sweep_y = 71
local sparkle_burst_single = { sprite_id = 'tsf8', x = 160, y = 63 }
local sparkle_burst_pair = { sprite_id = 'tsf_pair', x = 156, y = 63 }

local sparkle_delay_frames = 24
local sparkle_burst_single_frames = 8
local sparkle_burst_pair_frames = 16
local sparkle_burst_return_frames = 8
local sparkle_tail_frames = 60

local function build_title_sparkle_frames()
	local frames = {
		{
			value = {
				phase = 'delay',
				visible = false,
			},
			hold = sparkle_delay_frames,
		},
	}
	local sweep_frame = 1
	for x = sparkle_sweep_start_x, 150, 2 do
		if x == sparkle_sweep_frame_x[sweep_frame] then
			sweep_frame = sweep_frame + 1
		end
		frames[#frames + 1] = {
			value = {
				phase = 'sweep',
				visible = true,
				count = 1,
				primary_id = sparkle_sweep_sprite_ids[sweep_frame],
				primary_x = x,
				primary_y = sparkle_sweep_y,
			},
			hold = 1,
		}
	end
	frames[#frames + 1] = {
		value = {
			phase = 'burst_single',
			visible = true,
			count = 1,
			primary_id = sparkle_burst_single.sprite_id,
			primary_x = sparkle_burst_single.x,
			primary_y = sparkle_burst_single.y,
		},
		hold = sparkle_burst_single_frames,
	}
	frames[#frames + 1] = {
		value = {
			phase = 'burst_pair',
			visible = true,
			count = 1,
			primary_id = sparkle_burst_pair.sprite_id,
			primary_x = sparkle_burst_pair.x,
			primary_y = sparkle_burst_pair.y,
		},
		hold = sparkle_burst_pair_frames,
	}
	frames[#frames + 1] = {
		value = {
			phase = 'burst_return',
			visible = true,
			count = 1,
			primary_id = sparkle_burst_single.sprite_id,
			primary_x = sparkle_burst_single.x,
			primary_y = sparkle_burst_single.y,
		},
		hold = sparkle_burst_return_frames,
	}
	frames[#frames + 1] = {
		value = {
			phase = 'tail',
			visible = false,
		},
		hold = sparkle_tail_frames,
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

function title_screen:hide_dynamic_sparkle()
	self.sparkle_visible = false
	self.sparkle_visible_count = 0
	self.sparkle_sprite_id = 'none'
	self.sparkle_x = 0
	self.sparkle_y = 0
	self.sparkle_secondary_id = 'none'
	self.sparkle_secondary_x = 0
	self.sparkle_secondary_y = 0
end

function title_screen:set_dynamic_sparkle_single(sprite_id, x, y)
	self.sparkle_visible = true
	self.sparkle_visible_count = 1
	self.sparkle_sprite_id = sprite_id
	self.sparkle_x = x
	self.sparkle_y = y
	self.sparkle_secondary_id = 'none'
	self.sparkle_secondary_x = 0
	self.sparkle_secondary_y = 0
end

function title_screen:set_dynamic_sparkle_pair(primary_id, primary_x, primary_y, secondary_id, secondary_x, secondary_y)
	self.sparkle_visible = true
	self.sparkle_visible_count = 2
	self.sparkle_sprite_id = primary_id
	self.sparkle_x = primary_x
	self.sparkle_y = primary_y
	self.sparkle_secondary_id = secondary_id
	self.sparkle_secondary_x = secondary_x
	self.sparkle_secondary_y = secondary_y
end

function title_screen:disable_sparkle()
	self.sparkle_active = false
	self.sparkle_phase = 'off'
	self:hide_dynamic_sparkle()
end

-- The title sword-flash is absent in the SDL/C++ port source. These phases and
-- sprite attrs come from the original MSX ROM page 0x0E routine at T6251h.
function title_screen:reset_sparkle()
	self.sparkle_active = true
	self.sparkle_phase = 'delay'
	self:hide_dynamic_sparkle()
end

function title_screen:apply_sparkle_frame(frame)
	self.sparkle_phase = frame.phase
	if not frame.visible then
		self:hide_dynamic_sparkle()
		return
	end
	if frame.count == 2 then
		self:set_dynamic_sparkle_pair(
			frame.primary_id,
			frame.primary_x,
			frame.primary_y,
			frame.secondary_id,
			frame.secondary_x,
			frame.secondary_y
		)
		return
	end
	self:set_dynamic_sparkle_single(frame.primary_id, frame.primary_x, frame.primary_y)
end

function title_screen:render_sparkle()
	if not self.visible or not self.sparkle_active then
		return
	end
	put_sprite(sparkle_static.sprite_id, sparkle_static.x, sparkle_static.y, self.z + 1)
	if self.sparkle_visible_count >= 1 then
		put_sprite(self.sparkle_sprite_id, self.sparkle_x, self.sparkle_y, self.z + 1)
	end
	if self.sparkle_visible_count >= 2 then
		put_sprite(self.sparkle_secondary_id, self.sparkle_secondary_x, self.sparkle_secondary_y, self.z + 1)
	end
end

function title_screen:ctor()
	self.collider.enabled = false
	self:disable_sparkle()
	self:bind_visual()
end

function title_screen:enter_hidden()
	self:set_space(hidden_space_id)
	self:disable_sparkle()
end

function title_screen:enter_idle()
	self:set_space(title_space_id)
	self:reset_sparkle()
end

function title_screen:enter_starting()
	self:set_space(title_space_id)
	self:disable_sparkle()
end

function title_screen:show_idle_title()
	self:gfx('title_screen')
end

function title_screen:sync_start_sprite()
	self:gfx(self:get_timeline(start_timeline_id):value().sprite_id)
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
				entering_state = title_screen.enter_hidden,
			},
			idle = {
				entering_state = title_screen.enter_idle,
				timelines = {
					[idle_timeline_id] = {
						def = {
							frames = {
								{ sprite_id = 'title_screen' },
							},
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_frame = title_screen.show_idle_title,
					},
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
							self:apply_sparkle_frame(self:get_timeline(sparkle_timeline_id):value())
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
				entering_state = title_screen.enter_starting,
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
						on_frame = title_screen.sync_start_sprite,
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
			visible = true,
			z = 350,
		},
	})
end

return {
	define_title_screen_fsm = define_title_screen_fsm,
	register_title_screen_definition = register_title_screen_definition,
}
