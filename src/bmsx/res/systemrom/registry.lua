-- registry.lua
-- lightweight registry for lua engine objects/services

local registry = {}
registry.__index = registry

function registry.new()
	local self = setmetatable({}, registry)
	self._registry = {}
	return self
end

function registry:get(id)
	return self._registry[id]
end

function registry:has(id)
	return self._registry[id] ~= nil
end

function registry:register(entity)
	self._registry[entity.id] = entity
end

function registry:deregister(id_or_entity, remove_persistent)
	local id = type(id_or_entity) == "string" and id_or_entity or id_or_entity.id
	local entity = self._registry[id]
	if entity and entity.registrypersistent and not remove_persistent then
		return false
	end
	self._registry[id] = nil
	return true
end

function registry:get_persistent_entities()
	local out = {}
	for _, entity in pairs(self._registry) do
		if entity.registrypersistent then
			out[#out + 1] = entity
		end
	end
	return out
end

function registry:clear()
	for id, entity in pairs(self._registry) do
		if not entity.registrypersistent then
			self._registry[id] = nil
		end
	end
end

function registry:get_registered_entities()
	return self._registry
end

local function iter_registry(state, key)
	local reg = state.registry
	local type_name = state.type_name
	local persistent_only = state.persistent_only
	local next_key, entity = next(reg._registry, key)
	while next_key do
		if (not persistent_only or entity.registrypersistent) and (not type_name or entity.type_name == type_name) then
			return next_key, entity
		end
		next_key, entity = next(reg._registry, next_key)
	end
	return nil
end

function registry:iterate(type_name, persistent_only)
	return iter_registry, { registry = self, type_name = type_name, persistent_only = persistent_only }, nil
end

return {
	registry = registry,
	instance = registry.new(),
}
