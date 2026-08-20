local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local intro<const> = {}
intro.__index = intro

local intro_timeline_id<const> = 'intro.presentation'
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

local finish_intro<const> = function(self)
	self.events:emit('intro_done')
	return '/hidden'
end

function intro:ctor()
	local sinterklaas<const> = sprite_component.new({
		id_local = 'sinterklaas',
		imgid = 'intro_sinterklaas',
		offset_y = 6 * room_tile_size,
	})
	self:add_component(sinterklaas)
	self.sinterklaas = sinterklaas

	local boaz<const> = sprite_component.new({
		id_local = 'boaz',
		imgid = 'intro_boaz',
		offset_y = 10 * room_tile_size,
	})
	self:add_component(boaz)
	self.boaz = boaz
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
				entering_state = function()
					gx_texture.upload('intro_sinterklaas')
				end,
				timelines = {
					[intro_timeline_id] = {
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
						on_finished = finish_intro,
					},
				},
				input_event_handlers = {
					{
						pattern = 'lt[p] && touch[jp]',
						go = finish_intro,
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
		components = {
			timeline_component.new,
			fsm_component.factory({ 'intro' }),
		},
		defaults = {
			id = 'intro',
			player_index = 1,
		},
	})
end

return {
	define_intro_fsm = define_intro_fsm,
	register_intro_definition = register_intro_definition,
}
