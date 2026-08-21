local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local clock<const> = require('cartlib/clock')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

local intro<const> = {}
intro.__index = intro

local intro_definition_id<const> = 'nemesis_s.intro'
local intro_instance_id<const> = 'nemesis_s.intro'
local intro_fsm_id<const> = 'nemesis_s.intro.fsm'
local intro_timeline_id<const> = 'nemesis_s.intro.presentation'
local tile_size<const> = 8
-- Each logo advances one tile per Nemesis gameplay update. Millisecond waits
-- and the continuous timeline still consume the complete two-VBlank quantum.
local move_step_ms<const> = clock.update_milliseconds()
local nicolaas_move_start_ms<const> = 2000
local nicolaas_start_tile<const> = -28
local nicolaas_end_tile<const> = 2
local boaz_start_tile<const> = 32
local boaz_end_tile<const> = 4
local nicolaas_move_duration_ms<const> = (nicolaas_end_tile - nicolaas_start_tile) * move_step_ms
local boaz_move_start_ms<const> = nicolaas_move_start_ms + nicolaas_move_duration_ms + 3000
local boaz_move_duration_ms<const> = (boaz_start_tile - boaz_end_tile) * move_step_ms
local blackout_start_ms<const> = boaz_move_start_ms + boaz_move_duration_ms + 6000
local intro_duration_ms<const> = blackout_start_ms + 2000

local build_slide_keys<const> = function(start_time_ms, start_tile, end_tile)
	local direction<const> = end_tile > start_tile and 1 or -1
	local step_count<const> = (end_tile - start_tile) * direction
	local keys<const> = {
		{ time_ms = 0, value = start_tile * tile_size },
	}
	for step = 1, step_count do
		keys[#keys + 1] = {
			time_ms = start_time_ms + step * move_step_ms,
			value = (start_tile + step * direction) * tile_size,
		}
	end
	return keys
end

local finish_intro<const> = function(self)
	self.events:emit('intro_done')
	return '/hidden'
end

function intro:ctor()
	local nicolaas<const> = sprite_component.new({
		id_local = 'nicolaas',
		imgid = 'intro_sinterklaas',
		offset_y = 6 * tile_size,
	})
	self:add_component(nicolaas)
	self.nicolaas = nicolaas

	local boaz<const> = sprite_component.new({
		id_local = 'boaz',
		imgid = 'intro_boaz',
		offset_y = 10 * tile_size,
	})
	self:add_component(boaz)
	self.boaz = boaz
end

local define_fsm<const> = function()
	fsm_library.register(intro_fsm_id, {
		initial = 'hidden',
		on = {
			['intro'] = {
				emitter = ids_director_instance,
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
							continuous = true,
							duration_ms = intro_duration_ms,
							playback_mode = 'once',
							clock_source = timeline_clock_source.frame,
							tracks = {
								{
									kind = 'value',
									interpolation = 'step',
									path = { 'nicolaas', 'offset_x' },
									keys = build_slide_keys(
										nicolaas_move_start_ms,
										nicolaas_start_tile,
										nicolaas_end_tile
									),
								},
								{
									kind = 'value',
									interpolation = 'step',
									path = { 'boaz', 'offset_x' },
									keys = build_slide_keys(
										boaz_move_start_ms,
										boaz_start_tile,
										boaz_end_tile
									),
								},
								{
									kind = 'value',
									interpolation = 'step',
									path = { 'visible' },
									keys = {
										{ time_ms = 0, value = true },
										{ time_ms = blackout_start_ms, value = false },
									},
								},
							},
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
							play_rate = 0.7,
						},
						on_finished = finish_intro,
					},
				},
				input_event_handlers = {
					{ pattern = 'lt[p] && touch[jp]', go = finish_intro },
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = intro_definition_id,
		class = intro,
		components = {
			timeline_component.new,
			fsm_component.factory({ intro_fsm_id }),
		},
		defaults = {
			id = intro_instance_id,
			player_index = 1,
		},
	})
end

return {
	definition_id = intro_definition_id,
	instance_id = intro_instance_id,
	define_fsm = define_fsm,
	register_definition = register_definition,
}
