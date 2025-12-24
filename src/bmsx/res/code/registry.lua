-- registry.lua
-- Lightweight registry for Lua engine objects/services

local Registry = {}
Registry.__index = Registry

function Registry.new()
	local self = setmetatable({}, Registry)
	self._registry = {}
	return self
end

function Registry:get(id)
	return self._registry[id]
end

function Registry:has(id)
	return self._registry[id] ~= nil
end

function Registry:register(entity)
	self._registry[entity.id] = entity
end

function Registry:deregister(id_or_entity, remove_persistent)
	local id = type(id_or_entity) == "string" and id_or_entity or id_or_entity.id
	local entity = self._registry[id]
	if entity and entity.registrypersistent and not remove_persistent then
		return false
	end
	self._registry[id] = nil
	return true
end

function Registry:get_persistent_entities()
	local out = {}
	for _, entity in pairs(self._registry) do
		if entity.registrypersistent then
			out[#out + 1] = entity
		end
	end
	return out
end

function Registry:clear()
	for id, entity in pairs(self._registry) do
		if not entity.registrypersistent then
			self._registry[id] = nil
		end
	end
end

function Registry:get_registered_entities()
	local out = {}
	for _, entity in pairs(self._registry) do
		out[#out + 1] = entity
	end
	return out
end

function Registry:iterate(type_name, persistent_only)
	return coroutine.wrap(function()
		for _, entity in pairs(self._registry) do
			if not persistent_only or entity.registrypersistent then
				if not type_name or entity.type_name == type_name then
					coroutine.yield(entity)
				end
			end
		end
	end)
end

return {
	Registry = Registry,
	instance = Registry.new(),
}
