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

local actioneffect_component<const> = {}
actioneffect_component.__index = actioneffect_component
actioneffect_component.unique = true
setmetatable(actioneffect_component, { __index = base_component })

local definitions_by_id<const> = {}

local calculate_effect_cooldown<const> = function(effect, owner, payload, ...)
	local definition<const> = effect.definition
	local cooldown_ms = definition.cooldown_ms
	local calculate_cooldown_ms<const> = definition.calculate_cooldown_ms
	if calculate_cooldown_ms ~= nil then
		cooldown_ms = calculate_cooldown_ms(owner, payload, ...)
	end
	return cooldown_ms
end

local commit_effect_cooldown<const> = function(effect, owner, cooldown_ms)
	if cooldown_ms ~= nil then
		effect.cooldown_until_ms = owner.world.gameplay_time_ms + cooldown_ms
	else
		effect.cooldown_until_ms = nil
	end
end

function actioneffect_component.set_definition(id, definition)
	definitions_by_id[id] = definition
end

function actioneffect_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), actioneffect_component)
	self.effects = {}
	self.periodic_effects = {}
	self.periodic_effect_count = 0
	self._state_paths_ready = false
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
	self._state_paths_ready = false
	if self.parent.actioneffects == self then
		self.parent.actioneffects = nil
	end
end

function actioneffect_component:on_activate()
	if self._state_paths_ready then
		return
	end
	self._state_paths_ready = true
	local owner<const> = self.parent
	for _, effect in pairs(self.effects) do
		local definition<const> = effect.definition
		effect.required_states = bind_state_paths(owner, definition.required_state_paths)
		effect.blocked_states = bind_state_paths(owner, definition.blocked_state_paths)
	end
end

local add_periodic_effect<const> = function(self, effect)
	local index<const> = self.periodic_effect_count + 1
	self.periodic_effect_count = index
	self.periodic_effects[index] = effect
	effect.periodic_index = index
	if index == 1 then
		self:set_tick_clock_enabled(clock.gameplay, true)
	end
end

local remove_periodic_effect<const> = function(self, effect)
	local index<const> = effect.periodic_index
	if index == nil then
		return
	end
	local effects<const> = self.periodic_effects
	local count<const> = self.periodic_effect_count
	local last<const> = effects[count]
	effects[count] = nil
	self.periodic_effect_count = count - 1
	effect.periodic_index = nil
	effect.next_execution_ms = nil
	if index < count then
		effects[index] = last
		last.periodic_index = index
	end
	if count == 1 then
		self:set_tick_clock_enabled(clock.gameplay, false)
	end
end

function actioneffect_component:grant_effect(id)
	local owner<const> = self.parent
	local definition<const> = definitions_by_id[id]
	local effect<const> = {
		definition = definition,
		active_count = 0,
	}
	if self._state_paths_ready then
		effect.required_states = bind_state_paths(owner, definition.required_state_paths)
		effect.blocked_states = bind_state_paths(owner, definition.blocked_state_paths)
	end
	local initial_cooldown_ms<const> = definition.initial_cooldown_ms
	if initial_cooldown_ms ~= nil then
		effect.cooldown_until_ms = owner.world.gameplay_time_ms + initial_cooldown_ms
	end
	self.effects[id] = effect
end

function actioneffect_component:rebind_effect(id, definition)
	local effect<const> = self.effects[id]
	local owner<const> = self.parent
	remove_periodic_effect(self, effect)
	effect.definition = definition
	if self._state_paths_ready then
		effect.required_states = bind_state_paths(owner, definition.required_state_paths)
		effect.blocked_states = bind_state_paths(owner, definition.blocked_state_paths)
	else
		effect.required_states = nil
		effect.blocked_states = nil
	end
	if effect.active_count ~= 0 and definition.period_ms ~= nil then
		add_periodic_effect(self, effect)
		effect.next_execution_ms = owner.world.gameplay_time_ms + definition.period_ms
	end
end

function actioneffect_component:revoke_effect(id)
	remove_periodic_effect(self, self.effects[id])
	self.effects[id] = nil
end

function actioneffect_component:has_effect(id)
	return self.effects[id] ~= nil
end

-- Granting retains access to a definition; activation retains its runtime
-- presence. State machines use this boundary for scoped effects so periodic
-- execution is admitted on transitions instead of rediscovering state every
-- frame. Nested/concurrent states may retain the same effect independently.
function actioneffect_component:activate(id)
	local effect<const> = self.effects[id]
	local active_count<const> = effect.active_count
	effect.active_count = active_count + 1
	if active_count ~= 0 then
		return
	end
	local period_ms<const> = effect.definition.period_ms
	if period_ms ~= nil then
		if effect.periodic_index == nil then
			add_periodic_effect(self, effect)
			effect.next_execution_ms = self.parent.world.gameplay_time_ms + period_ms
		end
	end
end

function actioneffect_component:deactivate(id)
	local effect<const> = self.effects[id]
	effect.active_count = effect.active_count - 1
end

-- Cooldown commitment is normally part of successful activation. A deferred
-- cooldown calculates and retains its duration at activation, then commits at
-- the authored completion boundary so neither timing nor RNG ownership moves
-- into the caller.
function actioneffect_component:commit_cooldown(id, payload, ...)
	local effect<const> = self.effects[id]
	local cooldown_ms
	if effect.cooldown_pending then
		cooldown_ms = effect.pending_cooldown_ms
		effect.cooldown_pending = nil
		effect.pending_cooldown_ms = nil
	else
		cooldown_ms = calculate_effect_cooldown(effect, self.parent, payload, ...)
	end
	commit_effect_cooldown(effect, self.parent, cooldown_ms)
end

-- Admission stays separate from cooldown commitment and execution, matching
-- the component's public trigger phases. Scenario trace statements disappear
-- from ordinary builds, including their id/outcome arguments.
local effect_allows<const> = function(effect, owner, id, payload, ...)
	local definition<const> = effect.definition
	local required_tags<const> = definition.required_tags
	if required_tags then
		for i = 1, #required_tags do
			if not owner:has_tag(required_tags[i]) then
				blua32.trace(owner.actioneffects, 'actioneffect.trigger', id, 'required_tag_missing')
				return false
			end
		end
	end
	local blocked_tags<const> = definition.blocked_tags
	if blocked_tags then
		for i = 1, #blocked_tags do
			if owner:has_tag(blocked_tags[i]) then
				blua32.trace(owner.actioneffects, 'actioneffect.trigger', id, 'blocked_tag_present')
				return false
			end
		end
	end
	local required_states<const> = effect.required_states
	if required_states then
		for i = 1, #required_states do
			if not owner.state_machines:matches_state(required_states[i]) then
				blua32.trace(owner.actioneffects, 'actioneffect.trigger', id, 'required_state_missing')
				return false
			end
		end
	end
	local blocked_states<const> = effect.blocked_states
	if blocked_states then
		for i = 1, #blocked_states do
			if owner.state_machines:matches_state(blocked_states[i]) then
				blua32.trace(owner.actioneffects, 'actioneffect.trigger', id, 'blocked_state_present')
				return false
			end
		end
	end
	local gate<const> = definition.can_trigger
	if gate and not gate(owner, payload, ...) then
		blua32.trace(owner.actioneffects, 'actioneffect.trigger', id, 'custom_gate')
		return false
	end
	return true
end

local execute_effect<const> = function(effect, owner, payload, ...)
	local definition<const> = effect.definition
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

function actioneffect_component:trigger(id, payload, ...)
	local effect<const> = self.effects[id]
	local owner<const> = self.parent
	-- The world advances this clock once per admitted gameplay update. Cooldowns
	-- therefore need no component tick, stop with gameplay suspension and retain
	-- their meaning while their owner's space is inactive.
	local current_time_ms<const> = owner.world.gameplay_time_ms
	local cooldown_until_ms<const> = effect.cooldown_until_ms
	if cooldown_until_ms ~= nil and current_time_ms < cooldown_until_ms then
		blua32.trace(self, 'actioneffect.trigger', id, 'cooldown')
		return false
	end
	local definition<const> = effect.definition
	if not effect_allows(effect, owner, id, payload, ...) then
		return false
	end
	local cooldown_ms<const> = calculate_effect_cooldown(effect, owner, payload, ...)
	if definition.defer_cooldown_commit then
		effect.pending_cooldown_ms = cooldown_ms
		effect.cooldown_pending = true
	else
		commit_effect_cooldown(effect, owner, cooldown_ms)
	end
	blua32.trace(self, 'actioneffect.trigger', id, 'accepted')
	return execute_effect(effect, owner, payload, ...)
end

-- Periodic effects are retained active-effect records. The state/effect owner
-- activates them once; the frame path consumes only that dense active set and
-- never evaluates state paths, tags or cart-side timers.
function actioneffect_component:tick_periodic()
	local owner<const> = self.parent
	local current_time_ms<const> = owner.world.gameplay_time_ms
	local effects<const> = self.periodic_effects
	local index = 1
	while index <= self.periodic_effect_count do
		local effect<const> = effects[index]
		if effect.active_count == 0 then
			remove_periodic_effect(self, effect)
		else
			if current_time_ms >= effect.next_execution_ms then
				effect.next_execution_ms = effect.next_execution_ms + effect.definition.period_ms
				execute_effect(effect, owner)
			end
			if effect.active_count == 0 then
				remove_periodic_effect(self, effect)
			else
				index = index + 1
			end
		end
	end
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
