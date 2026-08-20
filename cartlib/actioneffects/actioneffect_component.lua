local base_component<const> = require('cartlib/component/base_component')

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

local actioneffect_component<const> = {}
actioneffect_component.__index = actioneffect_component
actioneffect_component.unique = true
setmetatable(actioneffect_component, { __index = base_component })

local definitions_by_id<const> = {}

function actioneffect_component.set_definition(id, definition)
	definitions_by_id[id] = definition
end

function actioneffect_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), actioneffect_component)
	self.effects = {}
	return self
end

function actioneffect_component.factory(effect_ids)
	return function(opts)
		local self<const> = actioneffect_component.new(opts)
		self._initial_effect_ids = effect_ids
		return self
	end
end

function actioneffect_component:on_attach()
	self.parent.actioneffects = self
	local initial_effect_ids<const> = self._initial_effect_ids
	if initial_effect_ids ~= nil then
		self._initial_effect_ids = nil
		for i = 1, #initial_effect_ids do
			self:grant_effect(initial_effect_ids[i])
		end
		return
	end
	for id in pairs(self.effects) do
		self:rebind_effect(id, definitions_by_id[id])
	end
end

function actioneffect_component:on_detach()
	if self.parent.actioneffects == self then
		self.parent.actioneffects = nil
	end
end

function actioneffect_component:grant_effect(id)
	local owner<const> = self.parent
	local definition<const> = definitions_by_id[id]
	local effect<const> = {
		definition = definition,
		required_states = bind_state_paths(owner, definition.required_state_paths),
		blocked_states = bind_state_paths(owner, definition.blocked_state_paths),
	}
	local initial_cooldown_ms<const> = definition.initial_cooldown_ms
	if initial_cooldown_ms ~= nil then
		effect.cooldown_until_ms = owner.world.gameplay_time_ms + initial_cooldown_ms
	end
	self.effects[id] = effect
end

function actioneffect_component:rebind_effect(id, definition)
	local effect<const> = self.effects[id]
	local owner<const> = self.parent
	effect.definition = definition
	effect.required_states = bind_state_paths(owner, definition.required_state_paths)
	effect.blocked_states = bind_state_paths(owner, definition.blocked_state_paths)
end

function actioneffect_component:revoke_effect(id)
	self.effects[id] = nil
end

function actioneffect_component:has_effect(id)
	return self.effects[id] ~= nil
end

function actioneffect_component:try_trigger(id, payload, ...)
	local effect<const> = self.effects[id]
	local definition<const> = effect.definition
	local owner<const> = self.parent
	-- The world advances this clock once per admitted gameplay update. Cooldowns
	-- therefore need no component tick, stop with gameplay suspension and retain
	-- their meaning while their owner's space is inactive.
	local current_time_ms<const> = owner.world.gameplay_time_ms
	local cooldown_until_ms<const> = effect.cooldown_until_ms
	if cooldown_until_ms ~= nil and current_time_ms < cooldown_until_ms then
		return false
	end
	if not tags_allow(owner, definition.required_tags, definition.blocked_tags)
		or not states_allow(owner, effect.required_states, effect.blocked_states) then
		return false
	end
	local gate<const> = definition.can_trigger
	if gate and not gate(owner, payload, ...) then
		return false
	end
	local cooldown_ms = definition.cooldown_ms
	local calculate_cooldown_ms<const> = definition.calculate_cooldown_ms
	if calculate_cooldown_ms ~= nil then
		cooldown_ms = calculate_cooldown_ms(owner, payload, ...)
	end
	if cooldown_ms ~= nil then
		effect.cooldown_until_ms = current_time_ms + cooldown_ms
	else
		effect.cooldown_until_ms = nil
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
	return true
end

function actioneffect_component:cooldown_remaining(id)
	local effect<const> = self.effects[id]
	if not effect then
		return nil
	end
	local cooldown_until_ms<const> = effect.cooldown_until_ms
	if cooldown_until_ms == nil then
		return nil
	end
	local remaining<const> = cooldown_until_ms - self.parent.world.gameplay_time_ms
	if remaining > 0 then
		return remaining
	end
	return nil
end

return actioneffect_component
