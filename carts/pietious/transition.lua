-- The director owns transition timing. This controller binds event payloads
-- to independently authored banner and game-over captions.
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/transition')
local transition<const> = {}
local clear_events<const> = {
	'room', 'halo', 'title', 'intro', 'story', 'epilogue', 'end_demo', 'victory_dance',
}

function transition:hide_captions()
	self.members.banner.visible = false
	self.members.death_caption.visible = false
end

function transition:ctor()
	self.members = scene_library.instantiate(scene.id)
	self:hide_captions()
end

local define_transition_fsm<const> = function()
	local on<const> = {
		transition = {
			emitter = 'd',
			go = function(self, _state, lines)
				self:hide_captions()
				self.members.banner.text_component:set_text(lines)
				self.members.banner.visible = lines ~= nil
			end,
		},
		death_screen = {
			emitter = 'd',
			go = function(self)
				self:hide_captions()
				self.members.death_caption.visible = true
			end,
		},
	}
	for i = 1, #clear_events do
		on[clear_events[i]] = { emitter = 'd', go = transition.hide_captions }
	end
	fsm_library.register('transition', { initial = 'active', on = on, states = { active = {} } })
end

local register_transition_definition<const> = function()
	scene.register()
	prefab.define({ def_id = 'transition', class = transition,
		components = { fsm_component.factory({ 'transition' }) }, defaults = { id = 'transition' } })
end

return {
	define_transition_fsm = define_transition_fsm,
	register_transition_definition = register_transition_definition,
}
