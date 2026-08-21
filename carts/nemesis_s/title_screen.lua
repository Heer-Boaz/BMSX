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
local selection_timeline_id<const> = 'nemesis_s.title_screen.selection'
local hangar_timeline_id<const> = 'nemesis_s.title_screen.hangar'
local launch_timeline_id<const> = 'nemesis_s.title_screen.launch'
local flicker_timeline_id<const> = 'nemesis_s.title_screen.flicker'
local full_burst_timeline_id<const> = 'nemesis_s.title_screen.full_burst'
local cooldown_timeline_id<const> = 'nemesis_s.title_screen.cooldown'
local blackout_timeline_id<const> = 'nemesis_s.title_screen.blackout'
local selection_flash_duration_ms<const> = 1500
local selection_flash_frame_ms<const> = 20
local selection_flash_frame_count<const> = selection_flash_duration_ms // selection_flash_frame_ms
local metalion_start_x<const> = 48
local metalion_start_y<const> = 129
local metalion_end_y<const> = 73
local flicker_duration_ms<const> = 600
local flicker_frame_ms<const> = 20
local flicker_frame_count<const> = flicker_duration_ms // flicker_frame_ms
local ship_images<const> = {
	[0] = 'title_startup_metalion',
	[1] = 'title_startup_metalion_burst_1',
	[2] = 'title_startup_metalion_burst_2',
	[3] = 'title_startup_metalion_burst_3',
}
local ship_position_keys<const> = {
	{ time_ms = 0, value = 129 },
	{ time_ms = 100, value = 121 },
	{ time_ms = 200, value = 113 },
	{ time_ms = 300, value = 105 },
	{ time_ms = 400, value = 97 },
	{ time_ms = 500, value = 89 },
	{ time_ms = 600, value = 81 },
	{ time_ms = 700, value = 73 },
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

local apply_selection_flash_frame<const> = function(target, frame)
	target.selection_hider.visible = (frame & 1) == 0
end

local apply_flicker_frame<const> = function(target, frame)
	target.burst_ship:set_imgid(ship_images[1 - (frame & 1)])
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

function title_screen:begin_flicker()
	self.burst_ship.visible = true
end

function title_screen:begin_full_burst()
	self.normal_ship.visible = false
	self.hangar_bottom_hider.visible = false
	self.burst_ship.visible = true
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
							continuous = true,
							duration_ms = 280,
							playback_mode = 'loop',
							clock_source = timeline_clock_source.frame,
							tracks = {
								{
									kind = 'value',
									interpolation = 'step',
									apply = apply_title_background,
									keys = {
										{ time_ms = 0, value = 1 },
										{ time_ms = 70, value = 2 },
										{ time_ms = 140, value = 1 },
										{ time_ms = 210, value = 2 },
									},
								},
								{
									kind = 'value',
									interpolation = 'step',
									path = { 'selector', 'visible' },
									keys = {
										{ time_ms = 0, value = true },
										{ time_ms = 140, value = false },
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
				initial = 'selection',
				states = {
					selection = {
						entering_state = title_screen.begin_selection_flash,
						timelines = {
							[selection_timeline_id] = {
								def = {
									frames = timeline.range(selection_flash_frame_count),
									frame_duration = selection_flash_frame_ms,
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									apply = apply_selection_flash_frame,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = '/startup/flight',
							},
						},
					},
					flight = {
						initial = 'launch',
						entering_state = title_screen.begin_flight,
						timelines = {
							[hangar_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = 500,
									playback_mode = 'loop',
									clock_source = timeline_clock_source.frame,
									tracks = {
										{
											kind = 'value',
											interpolation = 'step',
											apply = apply_hangar_background,
											keys = {
												{ time_ms = 0, value = 1 },
												{ time_ms = 250, value = 2 },
											},
										},
									},
								},
								autoplay = true,
								stop_on_exit = true,
							},
						},
						states = {
							launch = {
								timelines = {
									[launch_timeline_id] = {
										def = {
											continuous = true,
											duration_ms = 700,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											tracks = {
												{
													kind = 'value',
													interpolation = 'step',
													path = { 'normal_ship', 'offset_y' },
													keys = ship_position_keys,
												},
												{
													kind = 'value',
													interpolation = 'step',
													path = { 'burst_ship', 'offset_y' },
													keys = ship_position_keys,
												},
											},
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/flicker',
									},
								},
							},
							flicker = {
								entering_state = title_screen.begin_flicker,
								timelines = {
									[flicker_timeline_id] = {
										def = {
											frames = timeline.range(flicker_frame_count),
											frame_duration = flicker_frame_ms,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											apply = apply_flicker_frame,
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/full_burst',
									},
								},
							},
							full_burst = {
								entering_state = title_screen.begin_full_burst,
								timelines = {
									[full_burst_timeline_id] = {
										def = {
											continuous = true,
											duration_ms = 660,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											tracks = {
												{
													kind = 'value',
													interpolation = 'step',
													apply = apply_burst_frame,
													keys = {
														{ time_ms = 0, value = 0 },
														{ time_ms = 20, value = 1 },
														{ time_ms = 40, value = 2 },
														{ time_ms = 60, value = 3 },
													},
												},
											},
										},
										autoplay = true,
										stop_on_exit = true,
										on_finished = '/startup/flight/cooldown',
									},
								},
							},
							cooldown = {
								timelines = {
									[cooldown_timeline_id] = {
										def = {
											continuous = true,
											duration_ms = 200,
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											tracks = {
												{
													kind = 'value',
													interpolation = 'step',
													apply = apply_burst_frame,
													keys = {
														{ time_ms = 0, value = 3 },
														{ time_ms = 50, value = 2 },
														{ time_ms = 100, value = 1 },
														{ time_ms = 150, value = 0 },
													},
												},
											},
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
							[blackout_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = 2000,
									playback_mode = 'once',
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
