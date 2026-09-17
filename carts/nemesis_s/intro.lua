local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local scene_library<const> = require('cartlib/world/scene_library')
local intro_scene<const> = require('scenes/intro')
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
local logo_height<const> = 48
local logo_hold_frames<const> = 256

function intro:begin()
	atlas.load('intro')
	self.presentation = scene_library.instantiate(intro_scene.id)
	local logo<const> = self.presentation.logo
	logo.visible = false
	logo.sprite_component:set_region(0, 0, logo.sx, 1)
end

function intro:release_presentation()
	if self.presentation then
		scene_library.dispose(self.presentation)
		self.presentation = nil
	end
end

function intro:begin_reveal()
	self.presentation.logo.visible = true
end

function intro:reveal_row(frame)
	self.presentation.logo.sprite_component.region_height = frame + 1
end

function intro:finish()
	self.events:emit('intro_done')
	return '/hidden'
end

intro.ondespawn = intro.release_presentation

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
				exiting_state = intro.release_presentation,
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
		components = {
			timeline_component.new,
			fsm_component.factory({ intro_fsm_id }),
		},
		defaults = {
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
