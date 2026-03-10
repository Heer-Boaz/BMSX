-- registry.lua
-- lightweight registry for lua engine entities
--
-- DESIGN PRINCIPLES
--
-- 1. registrypersistent = true MEANS 'survives world.clear()'.
--    Objects with this flag are NOT removed on clear() and NOT serialized as
--    part of the savegame snapshot. Use it for global singletons that must
--    persist across room/level transitions (HUD, audio managers, etc.).
--
--      WRONG — marking a per-room enemy as persistent:
--        enemy.registrypersistent = true   -- it will leak across reloads
--
--      RIGHT — only mark long-lived singletons:
--        hud.registrypersistent = true
--
-- 2. DO NOT STORE REFERENCES OUTSIDE the registry.
--    Always look up entities via registry:get(id) or iterate(). Never cache
--    a reference across frames — the entity may have been deregistered.
--
-- 3. registry.instance IS THE GLOBAL SINGLETON.
--    Access it via  require('registry').instance — do not create additional
--    registry.new() instances unless you have an explicit separate scope.

local registry = {}
registry.__index = registry

function registry.new()
	local self = setmetatable({}, registry)
	self._registry = {}
	return self
end

-- registry:get(id): returns entity or nil (does not error on missing ids).
function registry:get(id)
	return self._registry[id]
end

-- registry:has(id): returns true if an entity with this id is currently registered.
function registry:has(id)
	return self._registry[id] ~= nil
end

-- registry:register(entity): adds entity to the registry keyed by entity.id.
--   entity.id must be set before calling this.
function registry:register(entity)
	local existing = self._registry[entity.id]
	if existing ~= nil and existing ~= entity then
		error('registry.register duplicate id '' .. entity.id .. ''')
	end
	self._registry[entity.id] = entity
end

-- registry:deregister(id_or_entity, remove_persistent?)
--   Removes the entity. If the entity has registrypersistent=true, removal is
--   a no-op unless remove_persistent is explicitly true. Returns false when
--   removal was blocked, true otherwise.
function registry:deregister(id_or_entity, remove_persistent)
	local id = type(id_or_entity) == 'string' and id_or_entity or id_or_entity.id
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

-- registry:clear(): removes all non-persistent entities from the registry.
--   Persistent entities (registrypersistent=true) are left untouched.
--   Called automatically on world.clear() / room transitions.
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

-- registry:iterate(type_name?, persistent_only?): returns an iterator over
--   registered entities. Both arguments are optional filters.
--     type_name      — only yield entities whose .type_name matches
--     persistent_only — when true, only yield persistent entities
function registry:iterate(type_name, persistent_only)
	return iter_registry, { registry = self, type_name = type_name, persistent_only = persistent_only }, nil
end

local function iter_by_tag(state, key)
	local reg = state.registry
	local tag = state.tag
	local next_key, entity = next(reg._registry, key)
	while next_key do
		local tags = entity.tags
		if tags and tags[tag] then
			return next_key, entity
		end
		next_key, entity = next(reg._registry, next_key)
	end
	return nil
end

-- registry:iterate_by_tag(tag): returns an iterator over registered entities
--   that carry the given tag in their .tags set (entity.tags[tag] == true).
function registry:iterate_by_tag(tag)
	return iter_by_tag, { registry = self, tag = tag }, nil
end

local function iter_by_tags(state, key)
	local reg = state.registry
	local wanted = state.tags
	local wanted_n = state.tags_n
	local next_key, entity = next(reg._registry, key)
	while next_key do
		local tags = entity.tags
		if tags then
			local match = true
			for i = 1, wanted_n do
				if not tags[wanted[i]] then
					match = false
					break
				end
			end
			if match then
				return next_key, entity
			end
		end
		next_key, entity = next(reg._registry, next_key)
	end
	return nil
end

-- registry:iterate_by_tags(tags): returns an iterator over registered entities
--   that carry ALL of the given tags. tags is an array of tag strings.
function registry:iterate_by_tags(tags)
	return iter_by_tags, { registry = self, tags = tags, tags_n = #tags }, nil
end

return {
	registry = registry,
	instance = registry.new(),
}
