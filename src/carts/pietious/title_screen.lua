local constants = require('constants')
local components = require('components')

local title_screen = {}
title_screen.__index = title_screen

local hidden_space_id = 'ui'
local title_space_id = 'transition'
local sparkle_timeline_id = 'title_screen.sparkle'
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

local sparkle_sweep_sprite_ids = {
	'tsf4',
	'tsf5',
	'tsf6',
	'tsf7',
}

local sparkle_sweep_start_x = 96
local sparkle_sweep_y = 71
local sparkle_sweep_stage_frames = 7
local sparkle_sweep_step_x = 2
local sparkle_burst_single = { sprite_id = 'tsf_burst_single', x = 160, y = 63 }
local sparkle_burst_pair = { sprite_id = 'tsf_pair', x = 158, y = 63 }

local sparkle_delay_frames = 48
local sparkle_burst_single_frames = 16
local sparkle_burst_pair_frames = 32
local sparkle_burst_return_frames = 16
local sparkle_tail_frames = 120

local function build_title_sparkle_frames()
	local frames = {}
	local function add_hidden_frame(phase, hold)
		frames[#frames + 1] = {
			value = {
				phase = phase,
				sparkle_sprite = {
					enabled = false,
				},
			},
			hold = hold,
		}
	end
	local function add_single_frame(phase, sprite_id, x, y, hold)
		frames[#frames + 1] = {
			value = {
				phase = phase,
				sparkle_sprite = {
					enabled = true,
					imgid = sprite_id,
					offset = {
						x = x,
						y = y,
					},
				},
			},
			hold = hold,
		}
	end
	add_hidden_frame('delay', sparkle_delay_frames)
	for i = 1, #sparkle_sweep_sprite_ids do
		local x = sparkle_sweep_start_x + ((i - 1) * sparkle_sweep_stage_frames * sparkle_sweep_step_x)
		for _ = 1, sparkle_sweep_stage_frames do
			add_single_frame('sweep', sparkle_sweep_sprite_ids[i], x, sparkle_sweep_y, 1)
			x = x + sparkle_sweep_step_x
		end
	end
	add_single_frame('burst_single', sparkle_burst_single.sprite_id, sparkle_burst_single.x, sparkle_burst_single.y, sparkle_burst_single_frames)
	add_single_frame('burst_pair', sparkle_burst_pair.sprite_id, sparkle_burst_pair.x, sparkle_burst_pair.y, sparkle_burst_pair_frames)
	add_single_frame('burst_return', sparkle_burst_single.sprite_id, sparkle_burst_single.x, sparkle_burst_single.y, sparkle_burst_return_frames)
	add_hidden_frame('tail', sparkle_tail_frames)
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

function title_screen:ctor()
	self.collider.enabled = false
	self:gfx('title_screen')
	self.z = 350
	self.sparkle_sprite = components.spritecomponent.new({
		id_local = 'sparkle',
		imgid = 'none',
		offset = { x = 0, y = 0, z = 1 },
	})
	self:add_component(self.sparkle_sprite)
	self.sparkle_sprite.enabled = false
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
					self:set_space(hidden_space_id)
					self.sparkle_sprite.enabled = false
				end,
			},
			idle = {
				entering_state = function(self)
					self:set_space(title_space_id)
					self:gfx('title_screen')
				end,
				timelines = {
					[sparkle_timeline_id] = {
						def = {
							frames = build_title_sparkle_frames(),
							playback_mode = 'once',
							apply = true,
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
				input_event_handlers = {
					['start[jp] || a[jp]'] = function(self)
						self.sparkle_sprite.enabled = false
						self.events:emit('title_start')
						return '/starting'
					end,
				},
			},
			starting = {
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
		fsms = { 'title_screen' },
	})
end

return {
	define_title_screen_fsm = define_title_screen_fsm,
	register_title_screen_definition = register_title_screen_definition,
}
