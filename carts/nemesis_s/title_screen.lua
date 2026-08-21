local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

local title_screen<const> = {}
title_screen.__index = title_screen

local title_definition_id<const> = 'nemesis_s.title_screen'
local title_instance_id<const> = 'nemesis_s.title_screen'
local title_fsm_id<const> = 'nemesis_s.title_screen.fsm'
local idle_timeline_id<const> = 'nemesis_s.title_screen.idle'
local confirmation_timeline_id<const> = 'nemesis_s.title_screen.confirmation'
local hangar_blackout_timeline_id<const> = 'nemesis_s.title_screen.hangar_blackout'
local hangar_timeline_id<const> = 'nemesis_s.title_screen.hangar'
local lift_timeline_id<const> = 'nemesis_s.title_screen.lift'
local ignition_timeline_id<const> = 'nemesis_s.title_screen.ignition'
local burst_ramp_timeline_id<const> = 'nemesis_s.title_screen.burst_ramp'
local burst_hold_timeline_id<const> = 'nemesis_s.title_screen.burst_hold'
local burst_cooldown_timeline_id<const> = 'nemesis_s.title_screen.burst_cooldown'
local departure_blackout_timeline_id<const> = 'nemesis_s.title_screen.departure_blackout'
local metalion_start_x<const> = 48
local metalion_start_y<const> = 129
local metalion_end_y<const> = 73
local selection_flash_cycles<const> = 10
local hangar_blackout_duration_frames<const> = 8
local hangar_duration_frames<const> = 194
local lift_duration_frames<const> = 58
local ignition_cycles<const> = 15
local burst_hold_duration_frames<const> = 49
local departure_blackout_duration_frames<const> = 107
local ship_images<const> = {
	[0] = 'title_startup_metalion',
	[1] = 'title_startup_metalion_burst_1',
	[2] = 'title_startup_metalion_burst_2',
	[3] = 'title_startup_metalion_burst_3',
}
local ship_position_keys<const> = {
	{ frame = 0, value = 129 },
	{ frame = 4, value = 121 },
	{ frame = 13, value = 113 },
	{ frame = 22, value = 105 },
	{ frame = 31, value = 97 },
	{ frame = 40, value = 89 },
	{ frame = 49, value = 81 },
}
local selection_flash_frames<const> = timeline.build_frame_sequence({
	{
		value = { selection_hider = { visible = true } },
		hold = 4,
	},
	{
		value = { selection_hider = { visible = false } },
		hold = 4,
	},
})
local ignition_frames<const> = timeline.build_frame_sequence({
	{ value = 1, hold = 2 },
	{ value = 0, hold = 2 },
})
local burst_ramp_frames<const> = timeline.build_frame_sequence({
	{ value = 0, hold = 4 },
	{ value = 1, hold = 4 },
	{ value = 2, hold = 4 },
})
local burst_cooldown_frames<const> = timeline.build_frame_sequence({
	{ value = 2, hold = 8 },
	{ value = 1, hold = 7 },
})
-- These are physical VBlank boundaries observed in the 50 Hz Nemesis 2 ROM.
-- The lift's VRAM work makes its early light intervals deliberately non-uniform.
local hangar_background_keys<const> = {
	{ frame = 0, value = 1 },
	{ frame = 4, value = 2 },
	{ frame = 21, value = 1 },
	{ frame = 39, value = 2 },
	{ frame = 57, value = 1 },
	{ frame = 74, value = 2 },
	{ frame = 90, value = 1 },
	{ frame = 106, value = 2 },
	{ frame = 122, value = 1 },
	{ frame = 138, value = 2 },
	{ frame = 154, value = 1 },
	{ frame = 170, value = 2 },
	{ frame = 187, value = 1 },
}

local draw_selection_hider<const> = function(component, draw)
	local owner<const> = component.parent
	draw:rect(104, owner.selector.offset_y, 168, owner.selector.offset_y + 8, 0xff000000)
end

local apply_title_background<const> = function(target, frame)
	target:set_imgid(frame == 1 and 'title_screen_1' or 'title_screen_2')
end

local apply_hangar_background<const> = function(target, frame)
	target:set_imgid(frame == 1 and 'title_hangar_1' or 'title_hangar_2')
end

local apply_burst_frame<const> = function(target, frame)
	target.burst_ship:set_imgid(ship_images[frame])
end

local apply_ship_position<const> = function(target, y)
	target.normal_ship.offset_y = y
	target.burst_ship.offset_y = y
end

function title_screen:enter_idle()
	gx_texture.upload('title_screen_1')
	gx_texture.upload('title_selector')
	self.visible = true
	self.selected_player_count = 1
	self:set_imgid('title_screen_1')
	self.selector.offset_y = 136
	self.selector.visible = true
	self.selection_hider.visible = false
	self.normal_ship.visible = false
	self.hangar_bottom_hider.visible = false
	self.burst_ship.visible = false
end

function title_screen:toggle_player_count()
	if self.selected_player_count == 1 then
		self.selected_player_count = 2
		self.selector.offset_y = 152
	else
		self.selected_player_count = 1
		self.selector.offset_y = 136
	end
	self.selector.visible = true
	self.timelines:play(idle_timeline_id, {
		rewind = true,
		snap_to_start = true,
	})
end

function title_screen:begin_selection_flash()
	self.events:emit('title_start')
	self.selector.visible = true
	self.selection_hider.visible = true
end

function title_screen:begin_flight()
	gx_texture.upload('title_hangar_1')
	self.visible = true
	self:set_imgid('title_hangar_1')
	self.selector.visible = false
	self.selection_hider.visible = false
	self.normal_ship.offset_x = metalion_start_x
	self.normal_ship.offset_y = metalion_start_y
	self.normal_ship:set_imgid(ship_images[0])
	self.normal_ship.visible = true
	self.hangar_bottom_hider.visible = true
	self.burst_ship.offset_x = metalion_start_x
	self.burst_ship.offset_y = metalion_start_y
	self.burst_ship.visible = false
end

function title_screen:begin_ignition()
	self.normal_ship.offset_y = metalion_end_y
	self.burst_ship.offset_y = metalion_end_y
	self.burst_ship.visible = true
end

function title_screen:begin_full_burst()
	self.normal_ship.visible = false
	self.hangar_bottom_hider.visible = false
	self.burst_ship.visible = true
	self.burst_ship:set_imgid(ship_images[3])
end

function title_screen:begin_blackout()
	self.visible = false
end

local finish_title<const> = function(self)
	self.events:emit('title_screen_done', {
		player_count = self.selected_player_count,
	})
	return '/hidden'
end

function title_screen:ctor()
	local selector<const> = sprite_component.new({
		id_local = 'selector',
		imgid = 'title_selector',
		offset_x = 80,
		offset_y = 136,
		offset_z = 1,
	})
	self:add_component(selector)
	self.selector = selector

	local selection_hider<const> = custom_visual_component.new({
		id_local = 'selection_hider',
		offset_z = 2,
		draw = draw_selection_hider,
	})
	selection_hider.visible = false
	self:add_component(selection_hider)
	self.selection_hider = selection_hider

	local normal_ship<const> = sprite_component.new({
		id_local = 'normal_ship',
		imgid = ship_images[0],
		offset_x = metalion_start_x,
		offset_y = metalion_start_y,
		offset_z = 3,
	})
	normal_ship.visible = false
	self:add_component(normal_ship)
	self.normal_ship = normal_ship

	local hangar_bottom_hider<const> = sprite_component.new({
		id_local = 'hangar_bottom_hider',
		imgid = 'title_hangar_bottom_hider',
		offset_y = 128,
		offset_z = 4,
	})
	hangar_bottom_hider.visible = false
	self:add_component(hangar_bottom_hider)
	self.hangar_bottom_hider = hangar_bottom_hider

	local burst_ship<const> = sprite_component.new({
		id_local = 'burst_ship',
		imgid = ship_images[0],
		offset_x = metalion_start_x,
		offset_y = metalion_end_y,
		offset_z = 5,
	})
	burst_ship.visible = false
	self:add_component(burst_ship)
	self.burst_ship = burst_ship
end

local define_fsm<const> = function()
	fsm_library.register(title_fsm_id, {
		initial = 'hidden',
		on = {
			['title'] = {
				emitter = ids_director_instance,
				go = '/idle',
			},
		},
		states = {
			hidden = {},
			idle = {
				entering_state = title_screen.enter_idle,
				timelines = {
					[idle_timeline_id] = {
						def = {
							frames = timeline.range(24),
							playback_mode = 'loop',
							clock_source = timeline_clock_source.frame,
							tracks = {
								{
									kind = 'value',
									interpolation = 'step',
									apply = apply_title_background,
									keys = {
										{ frame = 0, value = 1 },
										{ frame = 8, value = 2 },
										{ frame = 12, value = 1 },
										{ frame = 20, value = 2 },
									},
								},
								{
									kind = 'value',
									interpolation = 'step',
									path = { 'selector', 'visible' },
									keys = {
										{ frame = 0, value = true },
										{ frame = 12, value = false },
									},
								},
							},
						},
						autoplay = true,
						stop_on_exit = true,
					},
				},
				input_event_handlers = {
					{
						pattern = 'up[jp] || down[jp] || left[jp] || right[jp]',
						go = title_screen.toggle_player_count,
					},
					{
						pattern = 'touch[jp] || start[jp]',
						go = '/startup',
					},
				},
			},
			startup = {
				initial = 'confirmation',
				states = {
					confirmation = {
						entering_state = title_screen.begin_selection_flash,
						timelines = {
							[confirmation_timeline_id] = {
								def = {
									frames = selection_flash_frames,
									repetitions = selection_flash_cycles,
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									apply = true,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = '/startup/hangar_blackout',
							},
						},
					},
					hangar_blackout = {
						entering_state = title_screen.begin_blackout,
						timelines = {
							[hangar_blackout_timeline_id] = {
								def = {
									duration_frames = hangar_blackout_duration_frames,
									clock_source = timeline_clock_source.frame,
								},
								on_finished = '/startup/flight',
							},
						},
					},
					flight = {
						initial = 'lift',
						entering_state = title_screen.begin_flight,
						timelines = {
							[hangar_timeline_id] = {
								def = {
									frames = timeline.range(hangar_duration_frames),
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									tracks = {
										{
											kind = 'value',
											interpolation = 'step',
											apply = apply_hangar_background,
											keys = hangar_background_keys,
										},
									},
								},
								autoplay = true,
								stop_on_exit = true,
							},
						},
						states = {
							lift = {
								timelines = {
									[lift_timeline_id] = {
										def = {
											frames = timeline.range(lift_duration_frames),
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											tracks = {
												{
													kind = 'value',
													interpolation = 'step',
													apply = apply_ship_position,
													keys = ship_position_keys,
												},
											},
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/ignition',
									},
								},
							},
							ignition = {
								entering_state = title_screen.begin_ignition,
								timelines = {
									[ignition_timeline_id] = {
										def = {
											frames = ignition_frames,
											repetitions = ignition_cycles,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											apply = apply_burst_frame,
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/burst_ramp',
									},
								},
							},
							burst_ramp = {
								timelines = {
									[burst_ramp_timeline_id] = {
										def = {
											frames = burst_ramp_frames,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											apply = apply_burst_frame,
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/burst_hold',
									},
								},
							},
							burst_hold = {
								entering_state = title_screen.begin_full_burst,
								timelines = {
									[burst_hold_timeline_id] = {
										def = {
											duration_frames = burst_hold_duration_frames,
											clock_source = timeline_clock_source.frame,
										},
										on_finished = '/startup/flight/burst_cooldown',
									},
								},
							},
							burst_cooldown = {
								timelines = {
									[burst_cooldown_timeline_id] = {
										def = {
											frames = burst_cooldown_frames,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											apply = apply_burst_frame,
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/blackout',
									},
								},
							},
						},
					},
					blackout = {
						entering_state = title_screen.begin_blackout,
						timelines = {
							[departure_blackout_timeline_id] = {
								def = {
									duration_frames = departure_blackout_duration_frames,
									clock_source = timeline_clock_source.frame,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = finish_title,
							},
						},
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = title_definition_id,
		class = title_screen,
		base = sprite_object,
		components = {
			timeline_component.new,
			fsm_component.factory({ title_fsm_id }),
		},
		defaults = {
			id = title_instance_id,
			player_index = 1,
			imgid = 'title_screen_1',
			selected_player_count = 1,
		},
	})
end

return {
	definition_id = title_definition_id,
	instance_id = title_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
