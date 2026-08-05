-- world_object.lua
-- base class for all world objects (game entities)
--
-- DESIGN PRINCIPLES — object lifecycle and event subscription
--
-- 1. OBJECT LIFECYCLE ORDER.
--    new()        — allocates the object and its components; no event
--                   subscriptions here; the object is not yet active.
--    onspawn()    — called by world:spawn() after position is set from pos.
--                   Override for spawn-time setup.  No super call needed.
--    activate()   — called by world:spawn() after onspawn().  Sets
--                   active = true, calls bind(), then activates the attached
--                   components.
--    bind()       — override this in subclasses to subscribe to events.
--                   Called exactly once per activation.
--    ondespawn()  — called when removed from the world; deactivates the object.
--    dispose()    — final teardown; calls unbind() which removes all event
--                   subscriptions whose `subscriber` field is this object.
--
-- 2. bind() / unbind() — event subscription lifecycle.
--    All external event subscriptions must be registered inside bind(), not
--    in ctor / new().  Every subscription must set `subscriber = self` so
--    that the default unbind() can clean them up automatically via
--    remove_subscriber(self).
--
--    WRONG — subscribing in ctor (fires before object is active/ready):
--      function myobj:ctor()
--          self.events:on({ event = 'something', handler = function() ... end })
--      end
--    RIGHT — subscribing in bind():
--      function myobj:bind()
--          self.events:on({ event = 'something', emitter = 'src',
--              subscriber = self, handler = function() ... end })
--      end
--
--    Override unbind() only when you need extra cleanup beyond event
--    unsubscription (e.g. releasing external resources).  Always call
--    super's unbind via remove_subscriber if you do override it:
--      function myobj:unbind()
--          event_emitter:remove_subscriber(self)  -- base
--          -- additional cleanup ...
--      end
--
-- 3. NEVER CALL METHODS ON OTHER OBJECTS DIRECTLY FROM bind().
--    Subscriptions in bind() establish reactive wiring.  Do not reach into
--    other objects to mutate their state at bind()-time.  Emit an event and
--    let the other object respond, or use component activation for
--    initialisation that must happen on activate.
--
-- 4. DESPAWN THROUGH THE OBJECT'S WORLD.
--    self:despawn() is the only public destruction command. The world commits
--    it at the current tick-group barrier, or directly when no group is active.
--
-- 5. set_space() IS NOT despawn. Use it only to temporarily hide/show objects.
--    Moving an object to a non-active space hides it from gameplay queries
--    without destroying it (components and subscriptions persist).
--    Pattern: move enemies to 'transition' during screen transitions, not despawn.
local event_emitter<const> = require('cartlib/event_emitter')
local component<const> = require('cartlib/world/component')

local world_object<const> = {}
world_object.__index = world_object

function world_object.new(opts)
	local self<const> = setmetatable({}, world_object)
	self.type_name = opts.type_name
	self.id = opts.id
	self:set_pos(opts.x or 0, opts.y or 0, opts.z or 0)
	self.sx = opts.sx or 0
	self.sy = opts.sy or 0
	self.sz = opts.sz or 0
	self.visible = opts.visible == nil or opts.visible
	self.active = false
	self.player_index = opts.player_index
	self.tags = opts.tags or {}
	self._components = {}
	self._components_by_type = {}
	self.space_id = opts.space_id
	self.events = event_emitter.events_of(self)
	return self
end

-- set_pos(x, y, z?): sets world position. Each component falls back to the
-- current value when nil, so set_pos(x, y) preserves the current z.
function world_object:set_pos(x, y, z)
	self.x = x or self.x
	self.y = y or self.y
	if z ~= nil then
		self:set_z(z)
	end
end

function world_object:set_z(z)
	self.z = z
	if self._published then
		self.world:visual_depth_changed()
	end
end

-- set_space(space_id): moves this object into the named world space.
--   Useful for temporarily hiding an object from the active space (e.g. moving
--   enemies to a 'transition' space during a screen-transition animation and
--   back to 'main' on exit).  The object stays alive and subscribed; it is
--   simply excluded from the default active world queries.
--
--   PATTERN (enemies during shrine transition):
--     self.events:on('shrine_transition_enter', function()
--       self:set_space('transition')
--     end)
--     self.events:on('shrine_transition_exit', function()
--       self:set_space('main')
--     end)
function world_object:set_space(space_id)
	return self.world:set_object_space(self, space_id)
end

-- add_component(comp): attach a component to this object.
-- comp.bind() is called immediately; comp.on_attach() fires after binding.
-- Returns the component for chaining.  Components are updated by ECS systems,
-- as the object lacks its own update() method.
function world_object:add_component(comp)
	comp.parent = self
	if not comp.id then
		comp.id = component.generate_id(comp)
	end
	local key<const> = comp.type_name
	local bucket = self._components_by_type[key]
	if not bucket then
		bucket = {}
		self._components_by_type[key] = bucket
	end
	if comp.unique and #bucket > 0 then
		error('component "' .. (comp.type_name or key) .. '" is unique and already attached to "' .. self.id .. '"')
	end
	comp._attached = true
	local components<const> = self._components
	components[#components + 1] = comp
	bucket[#bucket + 1] = comp
	comp:bind()
	comp:on_attach()
	if self._published then
		self.world:attach_component(comp)
	end
	if self.active then
		comp:on_activate()
	end

	return comp
end

function world_object:get_component(type_name)
	local list<const> = self._components_by_type[type_name]
	return list and list[1]
end

function world_object:remove_component(comp)
	comp._attached = false
	if self._published then
		self.world:detach_component(comp)
	else
		self:_commit_component_detach(comp)
	end
end

function world_object:_commit_component_detach(comp)
	local key<const> = comp.type_name
	local components_by_type<const> = self._components_by_type
	local list<const> = components_by_type[key]
	if list then
		for i = #list, 1, -1 do
			if list[i] == comp then
				table.remove(list, i)
				break
			end
		end
		if #list == 0 then
			components_by_type[key] = nil
		end
	end
	local components<const> = self._components
	for i = #components, 1, -1 do
		if components[i] == comp then
			table.remove(components, i)
			break
		end
	end
	comp:on_detach()
	comp:unbind()
end

function world_object:_remove_all_components()
	local components<const> = self._components
	for i = #components, 1, -1 do
		self:remove_component(components[i])
	end
end


-- has_tag(tag): returns true if this object currently carries the given tag.
-- Tags are plain-string keys set on self.tags.  The FSM also manages tags
-- automatically through state `tags` declarations and timeline windows.
function world_object:has_tag(tag)
	return (self.tags[tag])
end

function world_object:add_tag(tag)
	if not self.tags[tag] then
		self.tags[tag] = true
		if self._published then
			self.world:reconcile_object_tag(self, tag)
		end
	end
end

function world_object:remove_tag(tag)
	if self.tags[tag] then
		self.tags[tag] = nil
		if self._published then
			self.world:reconcile_object_tag(self, tag)
		end
	end
end

function world_object:toggle_tag(tag)
	if self.tags[tag] then
		self:remove_tag(tag)
	else
		self:add_tag(tag)
	end
end

-- activate(): called by world:spawn() after onspawn(). Sets active = true,
-- calls bind(), then activates the components that were already attached.
-- Components added during bind activate through add_component() exactly once.
-- Do not call directly; spawn the object through the world instead.
function world_object:activate()
	local components<const> = self._components
	local component_count<const> = #components
	self.active = true
	if self._published then
		self.world:reconcile_object(self)
	end
	self:bind()
	for i = 1, component_count do
		components[i]:on_activate()
	end
end

-- bind(): override in subclasses to register event subscriptions.
-- Called once by activate() before attached components activate. Always set
-- `subscriber = self` on every subscription so unbind() cleans them up.
function world_object:bind()
end

-- unbind(): removes all event subscriptions whose subscriber == self.
-- Called by dispose().  Override only if you need extra teardown beyond
-- event unsubscription; in that case call the base implementation first.
function world_object:unbind()
	event_emitter:remove_subscriber(self)
end

-- deactivate(): removes the object and its components from active scheduling
-- without removing it from the world. Component state and event subscriptions
-- are preserved. Despawn commits remove the same membership directly before
-- the object's despawn callback runs.
-- Do not override; instead react to the 'despawn' event.
function world_object:deactivate()
	self.active = false
	if self._published then
		self.world:reconcile_object(self)
	end
end

-- onspawn(pos): called by world:spawn() after position is set from pos.
-- Override for spawn-time setup.  Position (x, y, z) is already applied.
-- activate(), bind(), component activation, and the 'spawn' event are handled
-- automatically by world:spawn() after this returns — no super call needed.
function world_object:onspawn(pos)
end

-- ondespawn(): called after world, space, Registry, and active membership have
-- been removed, while components and event state are still intact. Override
-- for despawn-specific cleanup; call the supermethod to emit 'despawn'.
function world_object:ondespawn()
	self.events:emit('despawn')
end

function world_object:despawn()
	self.world:despawn(self)
end

function world_object:dispose()
	self:_remove_all_components()
	self:unbind()
end

return world_object
