-- Behaviour-tree blackboard storage. Authored key names are resolved to dense
-- slots when the tree is registered; compiled nodes use those slots directly.
-- Program replacement remaps retained values by semantic key outside the frame
-- path, while task/service memory remains owned by the execution program.

local blackboard<const> = {}
local blackboard_instance<const> = {}
blackboard_instance.__index = blackboard_instance

local set_slot<const> = function(self, slot, value)
	self._values[slot] = value
end

local set_observed_slot<const> = function(self, slot, value)
	local values<const> = self._values
	if values[slot] ~= value then
		values[slot] = value
		local notify<const> = self._notifications[slot]
		if notify ~= nil then
			notify(self._execution, values)
		end
	end
end

function blackboard.compile(entries)
	local keys<const> = {}
	local slots_by_key<const> = {}
	local initial_values<const> = {}
	for index = 1, #entries do
		local entry<const> = entries[index]
		local key<const> = entry.key
		keys[index] = key
		slots_by_key[key] = index
		initial_values[index] = entry.initial_value
	end
	return {
		keys = keys,
		slots_by_key = slots_by_key,
		initial_values = initial_values,
	}
end

function blackboard.new()
	return setmetatable({
		_layout = nil,
		_values = nil,
		_notifications = nil,
		_execution = nil,
	}, blackboard_instance)
end

function blackboard_instance:rebind(layout, execution)
	local previous_layout<const> = self._layout
	local previous_values<const> = self._values
	local keys<const> = layout.keys
	local values<const> = {}
	if previous_layout == nil then
		local initial_values<const> = layout.initial_values
		for index = 1, #keys do
			values[index] = initial_values[index]
		end
	else
		local previous_slots<const> = previous_layout.slots_by_key
		local initial_values<const> = layout.initial_values
		for index = 1, #keys do
			local previous_slot<const> = previous_slots[keys[index]]
			if previous_slot == nil then
				values[index] = initial_values[index]
			else
				values[index] = previous_values[previous_slot]
			end
		end
	end
	self._layout = layout
	self._values = values
	self._notifications = layout.notifications
	self._execution = execution
	if layout.notifications == nil then
		self._set_slot = set_slot
	else
		self._set_slot = set_observed_slot
	end
end

function blackboard_instance:get(key)
	return self._values[self._layout.slots_by_key[key]]
end

function blackboard_instance:set(key, value)
	self:_set_slot(self._layout.slots_by_key[key], value)
end

return blackboard
