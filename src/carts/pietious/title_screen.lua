local constants<const> = require('constants')
local components<const> = require('components')

local title_screen<const> = {}
title_screen.__index = title_screen

local sparkle_timeline_id<const> = 'title_screen.sparkle'
local start_timeline_id<const> = 'title_screen.start'

local title_exit_events<const> = {
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

local sparkle_sweep_sprite_ids<const> = {
	'tsf4',
	'tsf5',
	'tsf6',
	'tsf7',
}

local sparkle_sweep_start_x<const> = 96
local sparkle_sweep_y<const> = 71
local sparkle_sweep_stage_frames<const> = 7
local sparkle_sweep_step_x<const> = 2
local sparkle_burst_single<const> = { sprite_id = 'tsf_burst_single', x = 160, y = 63 }
local sparkle_burst_pair<const> = { sprite_id = 'tsf_pair', x = 158, y = 63 }

local sparkle_delay_frames<const> = 48
local sparkle_burst_single_frames<const> = 16
local sparkle_burst_pair_frames<const> = 32
local sparkle_burst_return_frames<const> = 16
local sparkle_tail_frames<const> = 120

local build_title_sparkle_frames<const> = function()
	local frames<const> = {}
	local add_hidden_frame<const> = function(phase, hold)
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
	local add_single_frame<const> = function(phase, sprite_id, x, y, hold)
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

local build_title_start_frames<const> = function()
	local frames<const> = {}
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
		offset = { x = 0, y = 0, z = 1 },
	})
	self:add_component(self.sparkle_sprite)
	self.sparkle_sprite.enabled = false
end

local build_title_root_on<const> = function(show_path)
	local on<const> = {
		['title'] = {
			emitter = 'd',
			go = show_path,
		},
	}
	for i = 1, #title_exit_events do
		local event_name<const> = title_exit_events[i]
		on[event_name] = {
			emitter = 'd',
			go = '/hidden',
		}
	end
	return on
end

local define_title_screen_fsm<const> = function()
	define_fsm('title_screen', {
		initial = 'hidden',
		on = build_title_root_on('/idle'),
		states = {
			hidden = {},
			idle = {
				entering_state = function(self)
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

local register_title_screen_definition<const> = function()
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
