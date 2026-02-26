local constants = require('constants')
local font = require('font')

local transition = {}
transition.__index = transition

function transition:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_transition_overlay()
	end
end

function transition:bind_events()
	self.events:on({
		event = 'transition.mask.play',
		emitter = 'd',
		subscriber = self,
		handler = function()
			self:play_timeline('transition.timeline', { rewind = true, snap_to_start = true })
		end,
	})
end

function transition:draw_transition_overlay()
	local director_service = service('d')
	if director_service.overlay_mode == nil then
		return
	end
	local lines = director_service.overlay_text_lines
	if #lines > 0 then
		put_glyphs(lines, 0, constants.room.tile_origin_y + (constants.room.tile_size * 9), 341, {
			font = self.banner_font,
			center_block_width = display_width(),
		})
	end
end

function transition:ctor()
	self.banner_font = font.get('pietious')
	self:bind_visual()
	self:define_timeline(timeline.new({
		id = 'transition.timeline',
		frames = timeline.range(constants.flow.room_transition_frames),
		playback_mode = 'once',
	}))
	self:bind_events()
end

local function define_transition_fsm()
	define_fsm('transition', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_transition_definition()
	define_prefab({
		def_id = 'transition',
		class = transition,
		fsms = { 'transition' },
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'transition',
		},
	})
end

return {
	transition = transition,
	define_transition_fsm = define_transition_fsm,
	register_transition_definition = register_transition_definition,
}
