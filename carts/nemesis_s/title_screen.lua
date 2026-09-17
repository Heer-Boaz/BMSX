local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local scene_library<const> = require('cartlib/world/scene_library')
local world_object<const> = require('cartlib/world/world_object')
local title_scene<const> = require('scenes/title')
local hangar_scene<const> = require('scenes/hangar')
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
local metalion_lift_end<const> = -56
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
	{ frame = 0, value = 0 },
	{ frame = 4, value = -8 },
	{ frame = 13, value = -16 },
	{ frame = 22, value = -24 },
	{ frame = 31, value = -32 },
	{ frame = 40, value = -40 },
	{ frame = 49, value = -48 },
}
local selection_flash_frames<const> = timeline.build_frame_sequence({
	{
		value = { presentation = { members = { selection_cover = { visible = true } } } },
		hold = 4,
	},
	{
		value = { presentation = { members = { selection_cover = { visible = false } } } },
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

local apply_background<const> = function(target, frame)
	local background<const> = target.presentation.members.background
	background:set_imgid(background.images[frame])
end

local apply_burst_frame<const> = function(target, frame)
	target.presentation.members.ship.burst:set_imgid(ship_images[frame])
end

local apply_ship_position<const> = function(target, offset_y)
	local ship<const> = target.presentation.members.ship
	ship.y = ship.start_y + offset_y
end

function title_screen:release_presentation()
	if self.presentation then
		self.presentation:dispose()
		self.presentation = nil
	end
end

function title_screen:enter_idle()
	atlas.load('title')
	self:release_presentation()
	self.presentation = scene_library.instantiate(title_scene.id)
	self.selected_player_count = 1
end

function title_screen:toggle_player_count()
	self.selected_player_count = self.selected_player_count == 1 and 2 or 1
	local offset_y<const> = (self.selected_player_count - 1) * 16
	local members<const> = self.presentation.members
	members.selector.sprite_component.offset_y = offset_y
	members.selection_cover.visual.offset_y = offset_y
	members.selector.visible = true
	self.timelines:play(idle_timeline_id, {
		rewind = true,
		snap_to_start = true,
	})
end

function title_screen:begin_selection_flash()
	self.events:emit('title_start')
	self.presentation.members.selector.visible = true
	self.presentation.members.selection_cover.visible = true
end

function title_screen:begin_flight()
	self:release_presentation()
	self.presentation = scene_library.instantiate(hangar_scene.id)
end

function title_screen:begin_ignition()
	apply_ship_position(self, metalion_lift_end)
	self.presentation.members.ship.burst.visible = true
end

function title_screen:begin_full_burst()
	local members<const> = self.presentation.members
	members.ship.sprite_component.visible = false
	members.foreground.visible = false
	members.ship.burst.visible = true
	members.ship.burst:set_imgid(ship_images[3])
end

local finish_title<const> = function(self)
	self.events:emit('title_screen_done', {
		player_count = self.selected_player_count,
	})
	return '/hidden'
end

function title_screen:ondespawn()
	self:release_presentation()
	world_object.ondespawn(self)
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
			hidden = { entering_state = title_screen.release_presentation },
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
									apply = apply_background,
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
									path = { 'presentation', 'members', 'selector', 'visible' },
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
						pattern = 'confirm[jp]',
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
						entering_state = title_screen.release_presentation,
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
											apply = apply_background,
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
						entering_state = title_screen.release_presentation,
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
		base = world_object,
		components = {
			timeline_component.new,
			fsm_component.factory({ title_fsm_id }),
		},
		defaults = {
			player_index = 1,
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
