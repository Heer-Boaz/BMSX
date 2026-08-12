local basecomponent<const> = require('cartlib/component/basecomponent')

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
actioneffectcomponent.unique = true
setmetatable(actioneffectcomponent, { __index = basecomponent })

local definitions_by_id<const> = {}

function actioneffectcomponent.set_definition(id, definition)
	definitions_by_id[id] = definition
end

function actioneffectcomponent.new(opts)
	local self<const> = setmetatable(basecomponent.new(opts), actioneffectcomponent)
	self.effects = {}
	self.time_ms = 0
	return self
end

function actioneffectcomponent.factory(effect_ids)
	return function(opts)
		local self<const> = actioneffectcomponent.new(opts)
		self._initial_effect_ids = effect_ids
		return self
	end
end

function actioneffectcomponent:on_attach()
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

function actioneffectcomponent:on_detach()
	if self.parent.actioneffects == self then
		self.parent.actioneffects = nil
	end
end

function actioneffectcomponent:grant_effect(id)
	local owner<const> = self.parent
	local definition<const> = definitions_by_id[id]
	self.effects[id] = {
		definition = definition,
		required_states = bind_state_paths(owner, definition.required_state_paths),
		blocked_states = bind_state_paths(owner, definition.blocked_state_paths),
		cooldown_until = 0,
	}
end

function actioneffectcomponent:rebind_effect(id, definition)
	local effect<const> = self.effects[id]
	local owner<const> = self.parent
	effect.definition = definition
	effect.required_states = bind_state_paths(owner, definition.required_state_paths)
	effect.blocked_states = bind_state_paths(owner, definition.blocked_state_paths)
end

function actioneffectcomponent:revoke_effect(id)
	self.effects[id] = nil
end

function actioneffectcomponent:has_effect(id)
	return self.effects[id] ~= nil
end

function actioneffectcomponent:try_trigger(id, payload, ...)
	local effect<const> = self.effects[id]
	if self.time_ms < effect.cooldown_until then
		return false
	end
	local definition<const> = effect.definition
	local owner<const> = self.parent
	if not tags_allow(owner, definition.required_tags, definition.blocked_tags)
		or not states_allow(owner, effect.required_states, effect.blocked_states) then
		return false
	end
	local gate<const> = definition.can_trigger
	if gate and not gate(owner, payload, ...) then
		return false
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
	return true
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

return actioneffectcomponent
