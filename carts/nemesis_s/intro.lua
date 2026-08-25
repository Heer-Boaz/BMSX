local clock<const> = require('cartlib/clock')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

local intro<const> = {}
intro.__index = intro

local intro_definition_id<const> = 'nemesis_s.intro'
local intro_instance_id<const> = 'nemesis_s.intro'
local intro_fsm_id<const> = 'nemesis_s.intro.fsm'
local logo_blank_timeline_id<const> = 'nemesis_s.intro.blank'
local logo_reveal_timeline_id<const> = 'nemesis_s.intro.logo_reveal'
local logo_hold_timeline_id<const> = 'nemesis_s.intro.logo_hold'
local logo_background_id<const> = 'background'
local logo_x<const> = 40
local logo_y<const> = 64
local logo_width<const> = 168
local logo_height<const> = 48
local logo_hold_frames<const> = 256

local draw_logo_background<const> = function(_component, draw)
	draw:rect(0, 0, presentation_width, presentation_height, 0xffffffff)
end
local new_logo_background<const> = custom_visual_component.factory({
	id_local = logo_background_id,
	draw = draw_logo_background,
	offset_z = -1,
})

function intro:ctor()
	local logo<const> = self.sprite_component
	logo.offset_x = logo_x
	logo.offset_y = logo_y
	logo.visible = false
	logo:set_region(0, 0, logo_width, 1)
end

function intro:begin()
	local logo<const> = self.sprite_component
	logo.visible = false
	logo.region_height = 1
	atlas.load('intro')
end

function intro:begin_reveal()
	self.sprite_component.visible = true
end

function intro:reveal_row(frame)
	self.sprite_component.region_height = frame + 1
end

function intro:finish()
	self.sprite_component.visible = false
	self.events:emit('intro_done')
	return '/hidden'
end

local define_fsm<const> = function()
	-- Metal Gear initializes counters 60 and 49. DrawKonamiLogo consumes the
	-- first VBlank without copying, then exposes one of the 48 rows every two
	-- VBlanks. Its zero-initialized wait counter subsequently wraps after 256
	-- VBlanks before the next presentation is admitted.
	local logo_row_duration<const> = clock.frame_delta_milliseconds() * 2
	fsm_library.register(intro_fsm_id, {
		clock_source = clock.frame,
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
				initial = 'blank',
				entering_state = intro.begin,
				input_event_handlers = {
					{
						pattern = 'confirm[jp]',
						go = intro.finish,
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
								on_finished = '/playing/reveal',
							},
						},
					},
					reveal = {
						entering_state = intro.begin_reveal,
						timelines = {
							[logo_reveal_timeline_id] = {
								def = {
									frames = timeline.range(logo_height),
									frame_duration = logo_row_duration,
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									apply = intro.reveal_row,
								},
								on_finished = '/playing/hold',
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
								on_finished = intro.finish,
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
		def_id = intro_definition_id,
		class = intro,
		base = sprite_object,
		components = {
			new_logo_background,
			timeline_component.new,
			fsm_component.factory({ intro_fsm_id }),
		},
		defaults = {
			id = intro_instance_id,
			imgid = 'intro_konami',
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
