local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local intro<const> = {}
intro.__index = intro

local logo_blank_timeline_id<const> = 'intro.logo.blank'
local logo_reveal_timeline_id<const> = 'intro.logo.reveal'
local logo_hold_timeline_id<const> = 'intro.logo.hold'
local logo_background_id<const> = 'logo_background'
local logo_x<const> = 40
local logo_y<const> = 64
local logo_width<const> = 168
local logo_height<const> = 48
-- Pietious presents once per two physical VBlanks. One retained frame therefore
-- matches the source logo copier's two-VBlank row cadence, while 128 retained
-- frames preserve its 256-VBlank hold.
local logo_hold_frames<const> = 128

local draw_logo_background<const> = function(_component, draw)
	draw:rect(0, 0, screen_width, screen_height, 0xffffffff)
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

	local logo_background<const> = self:get_component(
		custom_visual_component,
		logo_background_id
	)
	logo_background.visible = false
	self.logo_background = logo_background
end

function intro:begin()
	self.visible = true
	self.logo_background.visible = true
	local logo<const> = self.sprite_component
	logo.visible = false
	logo.region_height = 1
	gx_texture.upload('intro_konami')
end

function intro:begin_reveal()
	self.sprite_component.visible = true
end

function intro:reveal_row(frame)
	self.sprite_component.region_height = frame + 1
end

function intro:finish()
	self.visible = false
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
