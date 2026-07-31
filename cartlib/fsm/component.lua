local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')
local fsm<const> = require('cartlib/fsm/fsm')
local state<const> = fsm.state

local statemachinecomponent<const> = {}
statemachinecomponent.__index = statemachinecomponent
setmetatable(statemachinecomponent, { __index = component })

function statemachinecomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.state_machine, true), statemachinecomponent)
	self.statemachines = {}
	self.statemachine_list = {}
	self.statemachine_count = 0
	self._started = false
	self._event_subscriptions = {}
	if opts.definition then
		local def<const> = opts.definition
		self:add_statemachine(def.id, def)
	end
	return self
end

function statemachinecomponent:on_attach()
	self.parent.state_machines = self
end

function statemachinecomponent:on_detach()
	self:dispose()
	self.parent.state_machines = nil
end

function statemachinecomponent:on_activate()
	self:start()
end

function statemachinecomponent:add_statemachine(id, definition)
	local machine<const> = state.new(definition, self.parent)
	local index<const> = self.statemachine_count + 1
	self.statemachine_count = index
	self.statemachine_list[index] = machine
	self.statemachines[id] = machine
	return machine
end

local bind_machine<const> = function(self, machine)
	local events<const> = machine.definition.event_list
	if not events or #events == 0 then
		return
	end
	for i = 1, #events do
		local event<const> = events[i]
		local key<const> = machine.localdef_id .. ':' .. event.name .. ':' .. tostring(event.emitter)
		if self._event_subscriptions[key] then
			goto continue
		end
		local disposer<const> = machine.target.events:on({
			event = event.name,
			emitter = event.emitter,
			handler = function(evt)
				self:auto_dispatch(evt)
			end,
			subscriber = machine.target,
		})
		self._event_subscriptions[key] = disposer
		::continue::
	end
end

local bind_machines<const> = function(self)
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		bind_machine(self, list[i])
	end
end

local unbind_machines<const> = function(self)
	for _, disposer in pairs(self._event_subscriptions) do
		disposer()
	end
end

function statemachinecomponent:auto_dispatch(event)
	local parent<const> = self.parent
	if not self.enabled or not parent.active then
		return
	end
	if not event.emitter then
		event.emitter = parent
	end
	self:dispatch(event)
end

-- statemachinecomponent:start(): start all managed FSMs from their initial
-- state.  Called automatically by worldobject:activate(); do not call
-- manually in normal cart code.
function statemachinecomponent:start()
	if self._started then
		return
	end
	bind_machines(self)
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:start()
	end
	self._started = true
end

function statemachinecomponent:update()
	local list<const> = self.statemachine_list
	-- Components only tick machines whose active subtree can actually do frame
	-- work. That keeps event-only and dormant FSMs out of the per-frame loop.
	for i = 1, self.statemachine_count do
		local machine<const> = list[i]
		if machine.active_frame_work then
			machine:update()
		end
	end
end

-- statemachinecomponent:dispatch(event_or_name, payload): deliver an event
-- to all FSMs managed by this controller.  The active state's `on` table and
-- `input_event_handlers` are consulted.  Returns true if any state handled it.
-- In cart code, call self.state_machines:dispatch() or use the FSM `on` table
-- instead of raw dispatch where possible.
function statemachinecomponent:dispatch(event_or_name, payload)
	local event_name
	local data
	if type(event_or_name) == 'table' then
		event_name = event_or_name.type
		data = event_or_name
	else
		event_name = event_or_name
		data = payload
	end
	local handled
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		if list[i]:dispatch_event(event_name, data) then
			handled = true
		end
	end
	return handled
end

-- statemachinecomponent:transition_to(path): directly navigate to a state
-- by absolute path, bypassing guard conditions and without requiring an event.
-- In cart code, prefer returning a path string from an `on`-handler or
-- `entering_state`; only call transition_to() for imperative external control
-- (e.g. a debug command or test harness).
-- Path format: 'machine_id:/state/substate' or just '/state' for the default
-- machine.
function statemachinecomponent:transition_to(path)
	local machine_id<const>, state_path = string.match(path, '^(.-):(/.+)$')
	local machine
	if machine_id then
		machine = self.statemachines[machine_id]
	else
		machine = self.statemachine_list[1]
		state_path = path
	end
	if not machine then
		error('no machine with id "' .. tostring(machine_id) .. '"')
	end
	machine:transition_to(state_path)
end

-- statemachinecomponent:matches_state_path(path): returns true if ANY managed
-- FSM is currently at the given path.  Useful for conditional logic outside
-- the FSM (e.g. an ECS system that changes behaviour based on active state).
-- Use tag-based queries (matches_state_tag) when possible — they are cheaper
-- and do not depend on internal state naming.
function statemachinecomponent:matches_state_path(path)
	local machine_id<const>, state_path<const> = string.match(path, '^(.-):(/.+)$')
	if machine_id then
		local machine<const> = self.statemachines[machine_id]
		if not machine then
			return false
		end
		return machine:matches_state_path(state_path)
	end
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		if list[i]:matches_state_path(path) then
			return true
		end
	end
	return false
end

function statemachinecomponent:dispose()
	self._started = false
	local list<const> = self.statemachine_list
	for i = 1, self.statemachine_count do
		list[i]:dispose()
	end
	unbind_machines(self)
end


return statemachinecomponent
