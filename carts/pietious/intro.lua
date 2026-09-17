local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/intro')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local intro<const> = {}
intro.__index = intro

local logo_blank_timeline_id<const> = 'intro.logo.blank'
local logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local logo_hold_timeline_id<const> = 'intro.logo.hold'
local logo_height<const> = 48
-- Pietious presents once per two physical VBlanks. One retained frame therefore
-- matches the source logo copier's two-VBlank row cadence, while 128 retained
-- frames preserve its 256-VBlank hold.
local logo_hold_frames<const> = 128

function intro:ctor()
	self.presentation = scene_library.instantiate(scene.id)
	self.members = self.presentation.members
	self.logo_sprite = self.members.logo.sprite_component
	self.logo_sprite.visible = false
	self.logo_background = self.members.background.visual
	self.logo_background.visible = false
end

function intro:begin()
	self.members.logo.visible = true
	self.logo_background.visible = true
	local logo<const> = self.logo_sprite
	logo.visible = false
	logo.region_height = 1
	atlas.load('intro')
end

function intro:begin_reveal()
	self.logo_sprite.visible = true
end

function intro:reveal_row(frame)
	self.logo_sprite.region_height = frame + 1
end

function intro:finish()
	self.members.logo.visible = false
	self.logo_background.visible = false
	self.events:emit('intro_done')
	return '/hidden'
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

local register_intro_definition<const> = function()
	scene.register()
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
