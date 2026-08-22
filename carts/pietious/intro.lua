local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local sprite_component<const> = require('cartlib/component/sprite_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local intro<const> = {}
intro.__index = intro

local logo_blank_timeline_id<const> = 'intro.logo.blank'
local logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local logo_hold_timeline_id<const> = 'intro.logo.hold'
local presentation_timeline_id<const> = 'intro.presentation'
local logo_background_id<const> = 'logo_background'
local logo_x<const> = 40
local logo_y<const> = 64
local logo_width<const> = 168
local logo_height<const> = 48
-- Pietious presents once per two physical VBlanks. One retained frame therefore
-- matches the source logo copier's two-VBlank row cadence, while 128 retained
-- frames preserve its 256-VBlank hold.
local logo_hold_frames<const> = 128
local wait_before_sinterklaas_frames<const> = 50
local wait_before_boaz_frames<const> = 75
local wait_before_blackout_frames<const> = 150
local blackout_frames<const> = 50
local sinterklaas_start_tile<const> = -28
local sinterklaas_end_tile<const> = 2
local boaz_start_tile<const> = 32
local boaz_end_tile<const> = 4
local sinterklaas_move_frames<const> = sinterklaas_end_tile - sinterklaas_start_tile
local boaz_move_frames<const> = boaz_start_tile - boaz_end_tile
local sinterklaas_move_start_frame<const> = wait_before_sinterklaas_frames
local boaz_move_start_frame<const> = sinterklaas_move_start_frame + sinterklaas_move_frames + wait_before_boaz_frames
local blackout_start_frame<const> = boaz_move_start_frame + boaz_move_frames + wait_before_blackout_frames
local intro_frame_count<const> = blackout_start_frame + blackout_frames

local draw_logo_background<const> = function(_component, draw)
	draw:rect(0, 0, screen_width, screen_height, 0xffffffff)
end

local new_logo_background<const> = custom_visual_component.factory({
	id_local = logo_background_id,
	draw = draw_logo_background,
	offset_z = -1,
})

-- Intro.MsBeforeMove is 40 ms. Pietious advances at the same 25 Hz cadence,
-- so every authored logo step occupies exactly one retained timeline frame.
local build_slide_keys<const> = function(start_frame, start_tile, end_tile)
	local direction<const> = end_tile > start_tile and 1 or -1
	local step_count<const> = (end_tile - start_tile) * direction
	local keys<const> = {
		{ frame = 0, value = start_tile * room_tile_size },
	}
	for step = 1, step_count do
		keys[#keys + 1] = {
			frame = start_frame + step,
			value = (start_tile + step * direction) * room_tile_size,
		}
	end
	return keys
end

function intro:finish()
	self.events:emit('intro_done')
	return '/hidden'
end

function intro:ctor()
	local logo<const> = self.sprite_component
	logo.offset_x = logo_x
	logo.offset_y = logo_y
	logo.visible = false
	logo:set_region(0, 0, logo_width, 1)

	local logo_background<const> = self:get_component(
		custom_visual_component,
		logo_background_id
	)
	logo_background.visible = false
	self.logo_background = logo_background

	local sinterklaas<const> = sprite_component.new({
		id_local = 'sinterklaas',
		imgid = 'intro_sinterklaas',
		offset_y = 6 * room_tile_size,
		visible = false,
	})
	self:add_component(sinterklaas)
	self.sinterklaas = sinterklaas

	local boaz<const> = sprite_component.new({
		id_local = 'boaz',
		imgid = 'intro_boaz',
		offset_y = 10 * room_tile_size,
		visible = false,
	})
	self:add_component(boaz)
	self.boaz = boaz
end

function intro:begin_logo()
	self.visible = true
	self.logo_background.visible = true
	local logo<const> = self.sprite_component
	logo.visible = false
	logo.region_height = 1
	self.sinterklaas.visible = false
	self.boaz.visible = false
	gx_texture.upload('intro_konami')
end

function intro:begin_logo_reveal()
	self.sprite_component.visible = true
end

function intro:reveal_logo_row(frame)
	self.sprite_component.region_height = frame + 1
end

function intro:begin_presentation()
	self.sprite_component.visible = false
	self.logo_background.visible = false
	self.sinterklaas.visible = true
	self.boaz.visible = true
end

local define_intro_fsm<const> = function()
	fsm_library.register('intro', {
		initial = 'hidden',
		on = {
			['intro'] = {
				emitter = 'd',
				go = '/playing',
			},
		},
		states = {
			hidden = {},
			playing = {
				initial = 'logo',
				states = {
					logo = {
						initial = 'blank',
						entering_state = intro.begin_logo,
						input_event_handlers = {
							{
								pattern = '?(up, down, left, right, a, b, x, y, lb, rb, lt, rt, start, home, touch, pause, key_letter)',
								go = '/playing/presentation',
							},
						},
						states = {
							blank = {
								timelines = {
									[logo_blank_timeline_id] = {
										def = {
											duration_frames = 1,
											clock_source = timeline_clock_source.frame,
										},
										on_finished = '/playing/logo/reveal',
									},
								},
							},
							reveal = {
								entering_state = intro.begin_logo_reveal,
								timelines = {
									[logo_reveal_timeline_id] = {
										def = {
											frames = timeline.range(logo_height),
											playback_mode = 'once',
											clock_source = timeline_clock_source.frame,
											apply = intro.reveal_logo_row,
										},
										on_finished = '/playing/logo/hold',
									},
								},
							},
							hold = {
								timelines = {
									[logo_hold_timeline_id] = {
										def = {
											duration_frames = logo_hold_frames,
											clock_source = timeline_clock_source.frame,
										},
										on_finished = '/playing/presentation',
									},
								},
							},
						},
					},
					presentation = {
						entering_state = intro.begin_presentation,
						timelines = {
							[presentation_timeline_id] = {
								def = {
									frames = timeline.range(intro_frame_count),
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									tracks = {
										{
											kind = 'value',
											interpolation = 'step',
											path = { 'sinterklaas', 'offset_x' },
											keys = build_slide_keys(
												sinterklaas_move_start_frame,
												sinterklaas_start_tile,
												sinterklaas_end_tile
											),
										},
										{
											kind = 'value',
											interpolation = 'step',
											path = { 'boaz', 'offset_x' },
											keys = build_slide_keys(
												boaz_move_start_frame,
												boaz_start_tile,
												boaz_end_tile
											),
										},
										{
											kind = 'value',
											interpolation = 'step',
											path = { 'visible' },
											keys = {
												{ frame = 0, value = true },
												{ frame = blackout_start_frame, value = false },
											},
										},
									},
								},
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = intro.finish,
							},
						},
						input_event_handlers = {
							{
								pattern = 'lt[p] && touch[jp]',
								go = intro.finish,
							},
						},
					},
				},
			},
		},
	})
end

local register_intro_definition<const> = function()
	prefab.define({
		def_id = 'intro',
		class = intro,
		base = sprite_object,
		components = {
			new_logo_background,
			timeline_component.new,
			fsm_component.factory({ 'intro' }),
		},
		defaults = {
			id = 'intro',
			imgid = 'intro_konami',
			player_index = 1,
		},
	})
end

return {
	define_intro_fsm = define_intro_fsm,
	register_intro_definition = register_intro_definition,
}
