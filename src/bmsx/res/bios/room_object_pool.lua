-- room_object_pool.lua
-- reusable pool of world objects driven by definition arrays (room data)
--
-- DESIGN PRINCIPLES
--
-- 1. THE POOL MANAGES OBJECT LIFETIME SO CART CODE DOESN'T HAVE TO.
--    Given an array of "definition" tables (e.g. enemy spawn points from room
--    data), the pool creates, activates, syncs, and deactivates objects in one
--    call each frame:
--
--      pool:sync_array(definitions, include_fn, context)
--
--    Objects that were active last frame but are absent from the new definitions
--    array are automatically deactivated (hidden + deactivated). Objects that
--    reappear are reused and re-synced — no reallocation.
--
-- 2. CREATE ONCE, REUSE MANY TIMES.
--    opts.create_instance(definition, context) is called only when an object
--    with the definition id does not yet exist in the world. From then on,
--    opts.activate_instance / opts.sync_instance are called every time the
--    definition is "used" in begin_cycle / use / end_cycle.
--
-- 3. begin_cycle / use / end_cycle PATTERN (manual control).
--    When sync_array is too coarse, drive the pool manually:
--      pool:begin_cycle()
--      for _, def in ipairs(visible_defs) do pool:use(def, ctx) end
--      pool:end_cycle()   -- deactivates everything not seen this cycle
--
-- 4. DO NOT SPAWN/DESPAWN POOL OBJECTS DIRECTLY.
--    The pool owns the object lifetime; only interact with them via use() and
--    the callbacks in opts.

local room_object_pool<const> = {}
room_object_pool.__index = room_object_pool

local activate_main<const> = function(instance)
	instance:set_space('main')
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
end

local deactivate_instance<const> = function(instance)
	instance.visible = false
	if instance.active then
		instance:deactivate()
	end
end

-- room_object_pool.new(opts)
--   opts fields (all required unless marked optional):
--     instances_by_id     — table{}  : shared map id→obj (mutated by the pool)
--     active_ids          — table{}  : shared set id→true (mutated by the pool)
--     create_instance(def, ctx)      — called once per new definition id; must
--                                      spawn and return the object
--     sync_instance(obj, def, ctx, was_active, was_missing)
--                                    — called every use(); update obj from def
--     activate_instance? (obj, def, ctx, was_active, was_missing)
--                                    — default: set_space("main") + activate()
--     deactivate_instance?(obj, id)  — default: deactivate() + visible=false
function room_object_pool.new(opts)
	return setmetatable({
		instances_by_id = opts.instances_by_id,
		active_ids = opts.active_ids,
		create_instance = opts.create_instance,
		sync_instance = opts.sync_instance,
		activate_instance = opts.activate_instance or activate_main,
		deactivate_instance = opts.deactivate_instance or deactivate_instance,
	}, room_object_pool)
end

-- room_object_pool:begin_cycle(): clears the active-ids set for this frame.
--   Must be followed by one or more :use() calls and then :end_cycle().
function room_object_pool:begin_cycle()
	clear_map(self.active_ids)
end

-- room_object_pool:use(definition, context)
--   Ensures an object for definition.id exists, activates it (if not already),
--   syncs it via sync_instance, and marks it active for this cycle.
--   Returns the object instance.
function room_object_pool:use(definition, context)
	local id<const> = definition.id
	local instance = oget(id)
	local was_missing<const> = instance == nil
	local was_active = false
	if not was_missing then
		was_active = instance.active
	end
	if instance == nil then
		instance = self.create_instance(definition, context)
	end
	self.instances_by_id[id] = instance
	self.active_ids[id] = true
	self.activate_instance(instance, definition, context, was_active, was_missing)
	self.sync_instance(instance, definition, context, was_active, was_missing)
	return instance
end

function room_object_pool:mark_active(id)
	self.active_ids[id] = true
end

-- room_object_pool:end_cycle(): deactivates all objects that were NOT used
--   this cycle (i.e. absent from the definitions list). Cleans up stale ids
--   for objects that no longer exist in the world.
function room_object_pool:end_cycle()
	for id in pairs(self.instances_by_id) do
		local instance<const> = oget(id)
		if instance == nil then
			self.instances_by_id[id] = nil
		else
			self.instances_by_id[id] = instance
			if not self.active_ids[id] then
				self.deactivate_instance(instance, id)
			end
		end
	end
end

function room_object_pool:deactivate_id(id)
	self.active_ids[id] = nil
	self.instances_by_id[id] = nil
	local instance<const> = oget(id)
	if instance ~= nil then
		self.deactivate_instance(instance, id)
	end
end

-- room_object_pool:sync_array(definitions, include_definition?, context)
--   Convenience wrapper: calls begin_cycle, iterates definitions calling use()
--   for each (optionally filtered by include_definition(def, ctx) → bool), then
--   calls end_cycle. This is the main entry point for room-data-driven pools.
function room_object_pool:sync_array(definitions, include_definition, context)
	self:begin_cycle()
	for i = 1, #definitions do
		local definition<const> = definitions[i]
		if include_definition == nil or include_definition(definition, context) then
			self:use(definition, context)
		end
	end
	self:end_cycle()
end

return room_object_pool
