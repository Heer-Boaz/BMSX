local basecomponent<const> = require('cartlib/component/basecomponent')
local definitions_by_id<const> = require('cartlib/fsm/definitions')
local eventemitter<const> = require('cartlib/eventemitter')
local fsm<const> = require('cartlib/fsm/fsm')
local state<const> = fsm.state
local bind_machine_state_path<const> = fsm.bind_state_path
local machine_matches_state_path<const> = fsm.matches_state_path
local transition_machine_state_path<const> = fsm.transition_state_path

local fsmcomponent<const> = {}
fsmcomponent.__index = fsmcomponent
fsmcomponent.unique = true
setmetatable(fsmcomponent, { __index = basecomponent })

local unfiltered_emitter<const> = {}
local default_emitter<const> = {}
function fsmcomponent.new(opts, machine_ids)
	local self<const> = setmetatable(basecomponent.new(opts), fsmcomponent)
	self._machines_by_id = {}
	self._machines = {}
	self._machine_count = 0
	self._started = false
	self._state_paths = nil
	for i = 1, #machine_ids do
		local machine_id<const> = machine_ids[i]
		self:add_state_machine(machine_id, definitions_by_id[machine_id])
	end
	return self
end

function fsmcomponent.factory(machine_ids)
	return function(opts)
		return fsmcomponent.new(opts, machine_ids)
	end
end

function fsmcomponent:on_attach()
	self.parent.state_machines = self
end

function fsmcomponent:on_detach()
	self:dispose()
	if self.parent.state_machines == self then
		self.parent.state_machines = nil
	end
end

function fsmcomponent:on_activate()
	self:start()
end

local append_bound_machine<const> = function(bound, machine, path)
	local count<const> = bound.count + 1
	bound.count = count
	bound[count * 2 - 1] = machine
	bound[count * 2] = bind_machine_state_path(machine.definition, path)
end

function fsmcomponent:add_state_machine(id, definition)
	local machine<const> = state.new(definition, self.parent)
	local index<const> = self._machine_count + 1
	self._machine_count = index
	self._machines[index] = machine
	self._machines_by_id[id] = machine
	local paths<const> = self._state_paths
	if paths then
		for path, bound in pairs(paths) do
			if not string.find(path, ':/', 1, true) then
				append_bound_machine(bound, machine, path)
			end
		end
	end
	return machine
end

local bind_machines<const> = function(self)
	local filters_by_event<const> = {}
	local list<const> = self._machines
	for i = 1, self._machine_count do
		local machine<const> = list[i]
		local events<const> = machine.definition.event_list
		for j = 1, #events do
			local event<const> = events[j]
			local filters = filters_by_event[event.name]
			if event.unfiltered then
				filters_by_event[event.name] = unfiltered_emitter
			elseif filters ~= unfiltered_emitter then
				if not filters then
					filters = {}
					filters_by_event[event.name] = filters
				end
				local emitter<const> = event.emitter
				local effective<const> = emitter or machine.target.id
				filters[effective] = emitter or default_emitter
			end
		end
	end
	for event_name, filters in pairs(filters_by_event) do
		if filters == unfiltered_emitter then
			eventemitter:on({
				event = event_name,
				handler = function(dispatched_type, emitter, payload, emitter_id)
					self:auto_dispatch(dispatched_type, emitter, payload, emitter_id)
				end,
				subscriber = self,
			})
		else
			for _, emitter in pairs(filters) do
				local emitter_filter = emitter
				if emitter_filter == default_emitter then
					emitter_filter = nil
				end
				self.parent.events:on({
					event = event_name,
					emitter = emitter_filter,
					handler = function(dispatched_type, emitter, payload, emitter_id)
						self:auto_dispatch(dispatched_type, emitter, payload, emitter_id)
					end,
					subscriber = self,
				})
			end
		end
	end
end

function fsmcomponent:rebind_state_machine(id, definition)
	local machine<const> = self._machines_by_id[id]
	if machine == nil then
		return
	end
	machine:rebind_definition(definition)
	self._state_paths = nil
	if self._started then
		self:unbind()
		bind_machines(self)
	end
end

function fsmcomponent:auto_dispatch(event_type, emitter, payload, emitter_id)
	local parent<const> = self.parent
	if not self.enabled or not parent.active then
		return
	end
	self:dispatch(event_type, payload, emitter, emitter_id)
end

-- fsmcomponent:start(): start all managed FSMs from their initial
-- state.  Called automatically by worldobject:activate(); do not call
-- manually in normal cart code.
function fsmcomponent:start()
	if self._started then
		return
	end
	bind_machines(self)
	local list<const> = self._machines
	for i = 1, self._machine_count do
		list[i]:start()
	end
	self._started = true
end

function fsmcomponent:update()
	local list<const> = self._machines
	-- Components only tick machines whose active subtree can actually do frame
	-- work. That keeps event-only and dormant FSMs out of the per-frame loop.
	for i = 1, self._machine_count do
		local machine<const> = list[i]
		if machine.active_frame_work then
			machine:update()
		end
	end
end

-- fsmcomponent:dispatch(event_name, payload): deliver an event
-- to all FSMs managed by this controller.  The active state's `on` table and
-- `input_event_handlers` are consulted.  Returns true if any state handled it.
-- In cart code, call self.state_machines:dispatch() or use the FSM `on` table
-- instead of raw dispatch where possible.
function fsmcomponent:dispatch(event_name, payload, emitter, emitter_id)
	if emitter_id == nil then
		emitter = self.parent
		emitter_id = self.parent.id
	end
	local handled
	local list<const> = self._machines
	for i = 1, self._machine_count do
		if list[i]:dispatch_event(event_name, payload, emitter, emitter_id) then
			handled = true
		end
	end
	return handled
end

function fsmcomponent:bind_state_path(path)
	local paths = self._state_paths
	if paths then
		local bound<const> = paths[path]
		if bound then
			return bound
		end
	else
		paths = {}
		self._state_paths = paths
	end
	local separator<const> = string.find(path, ':/', 1, true)
	local machine_id
	local machine_path = path
	if separator and separator + 1 < #path then
		machine_id = string.sub(path, 1, separator - 1)
		machine_path = string.sub(path, separator + 1)
	end
	local bound<const> = { count = 0 }
	if machine_id then
		local machine<const> = self._machines_by_id[machine_id]
		if not machine then
			error('no machine with id "' .. machine_id .. '"')
		end
		append_bound_machine(bound, machine, machine_path)
	else
		local machines<const> = self._machines
		local count<const> = self._machine_count
		for i = 1, count do
			append_bound_machine(bound, machines[i], machine_path)
		end
	end
	paths[path] = bound
	return bound
end

function fsmcomponent:matches_state(bound)
	for i = 1, bound.count do
		if machine_matches_state_path(bound[i * 2 - 1], bound[i * 2]) then
			return true
		end
	end
	return false
end

-- fsmcomponent:transition_to(path): directly navigate to a state
-- by absolute path, bypassing guard conditions and without requiring an event.
-- In cart code, prefer returning a path string from an `on`-handler or
-- `entering_state`; only call transition_to() for imperative external control
-- (e.g. a debug command or test harness).
-- Path format: 'machine_id:/state/substate' or just '/state' for the default
-- machine.
function fsmcomponent:transition_to(path)
	local bound<const> = self:bind_state_path(path)
	transition_machine_state_path(bound[1], bound[2])
end

function fsmcomponent:dispose()
	self._started = false
	local list<const> = self._machines
	for i = 1, self._machine_count do
		list[i]:dispose()
	end
end


return fsmcomponent
