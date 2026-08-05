local component<const> = require('cartlib/world/component')

local action_effects<const> = {}
local definitions<const> = {}

action_effects.effecttype = {
	spawn = 'spawn',
	despawn = 'despawn',
	damage = 'damage',
	heal = 'heal',
	move = 'move',
	play_sound = 'play_sound',
	play_animation = 'play_animation',
	emit_event = 'emit_event',
}

function action_effects.register_effect(id, definition)
	definitions[id] = definition
end

action_effects.register_effect(action_effects.effecttype.move, {
	handler = function(owner, _payload, dx, dy)
		owner.x = owner.x + dx
		owner.y = owner.y + dy
	end,
})

action_effects.register_effect(action_effects.effecttype.play_animation, {
	handler = function(owner, _payload, animation_id, options)
		owner.timelines:play(animation_id, options)
	end,
})

local bind_state_paths<const> = function(owner, paths)
	if not paths then
		return nil
	end
	local bound<const> = {}
	for i = 1, #paths do
		bound[i] = owner.state_machines:bind_state_path(paths[i])
	end
	return bound
end

local tags_allow<const> = function(owner, required, blocked)
	if required then
		for i = 1, #required do
			if not owner:has_tag(required[i]) then
				return false
			end
		end
	end
	if blocked then
		for i = 1, #blocked do
			if owner:has_tag(blocked[i]) then
				return false
			end
		end
	end
	return true
end

local states_allow<const> = function(owner, required, blocked)
	if required then
		for i = 1, #required do
			if not owner.state_machines:matches_state(required[i]) then
				return false
			end
		end
	end
	if blocked then
		for i = 1, #blocked do
			if owner.state_machines:matches_state(blocked[i]) then
				return false
			end
		end
	end
	return true
end

local actioneffectcomponent<const> = {}
actioneffectcomponent.__index = actioneffectcomponent
actioneffectcomponent.type_name = 'actioneffectcomponent'
setmetatable(actioneffectcomponent, { __index = component })

function actioneffectcomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, actioneffectcomponent.type_name, true), actioneffectcomponent)
	self.effects = {}
	self.time_ms = 0
	return self
end

function actioneffectcomponent.factory(effect_ids)
	return function(opts)
		local self<const> = actioneffectcomponent.new(opts)
		for i = 1, #effect_ids do
			self:grant_effect(effect_ids[i])
		end
		return self
	end
end

function actioneffectcomponent:on_attach()
	self.parent.actioneffects = self
end

function actioneffectcomponent:on_detach()
	self.parent.actioneffects = nil
end

function actioneffectcomponent:grant_effect(id)
	local owner<const> = self.parent
	local definition<const> = definitions[id]
	self.effects[id] = {
		definition = definition,
		required_states = bind_state_paths(owner, definition.required_state_paths),
		blocked_states = bind_state_paths(owner, definition.blocked_state_paths),
		cooldown_until = 0,
	}
end

function actioneffectcomponent:revoke_effect(id)
	self.effects[id] = nil
end

function actioneffectcomponent:has_effect(id)
	return self.effects[id] ~= nil
end

function actioneffectcomponent:trigger(id, payload, ...)
	local effect<const> = self.effects[id]
	if not effect then
		return 'failed'
	end
	if self.time_ms < effect.cooldown_until then
		return 'on_cooldown'
	end
	local definition<const> = effect.definition
	local owner<const> = self.parent
	if not tags_allow(owner, definition.required_tags, definition.blocked_tags)
		or not states_allow(owner, effect.required_states, effect.blocked_states) then
		return 'blocked'
	end
	local gate<const> = definition.can_trigger
	if gate and not gate(owner, payload, ...) then
		return 'blocked'
	end
	local event_type = definition.event
	local event_payload = payload
	local handler<const> = definition.handler
	if handler then
		local handler_event<const>, handler_payload<const> = handler(owner, payload, ...)
		if handler_event ~= nil then
			event_type = handler_event
		end
		if handler_payload ~= nil then
			event_payload = handler_payload
		end
	end
	if event_type then
		owner.events:emit(event_type, event_payload)
	end
	local cooldown<const> = definition.cooldown_ms
	if cooldown and cooldown > 0 then
		effect.cooldown_until = self.time_ms + cooldown
	end
	return 'ok'
end

function actioneffectcomponent:cooldown_remaining(id)
	local effect<const> = self.effects[id]
	if not effect then
		return nil
	end
	local remaining<const> = effect.cooldown_until - self.time_ms
	if remaining > 0 then
		return remaining
	end
	return nil
end

action_effects.actioneffectcomponent = actioneffectcomponent

return action_effects
