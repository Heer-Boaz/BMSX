local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')

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
	self.effects[id] = {
		definition = definition,
		required_states = bind_state_paths(owner, definition.required_state_paths),
		blocked_states = bind_state_paths(owner, definition.blocked_state_paths),
	}
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
	-- Cooldowns retain machine-clock samples instead of ticking every component.
	-- Inactive spaces therefore incur no update work and elapsed machine time has
	-- the same meaning when an action is queried again.
	local current_time_ms
	local cooldown_duration_ms<const> = effect.cooldown_duration_ms
	if cooldown_duration_ms ~= nil then
		current_time_ms = clock.milliseconds()
		if clock.elapsed_milliseconds(effect.cooldown_start_time_ms, current_time_ms) < cooldown_duration_ms then
			return false
		end
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
		if current_time_ms == nil then
			current_time_ms = clock.milliseconds()
		end
		effect.cooldown_start_time_ms = current_time_ms
		effect.cooldown_duration_ms = cooldown
	else
		effect.cooldown_duration_ms = nil
	end
	return true
end

function actioneffect_component:cooldown_remaining(id)
	local effect<const> = self.effects[id]
	if not effect then
		return nil
	end
	local duration<const> = effect.cooldown_duration_ms
	if duration == nil then
		return nil
	end
	local remaining<const> = duration - clock.elapsed_milliseconds(
		effect.cooldown_start_time_ms,
		clock.milliseconds()
	)
	if remaining > 0 then
		return remaining
	end
	return nil
end

return actioneffect_component
