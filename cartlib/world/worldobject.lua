-- worldobject.lua
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
--                   active = true, binds a new object once, then activates
--                   the attached components.
--    bind()       — override this in subclasses to subscribe to events.
--                   Called exactly once during the object's lifetime.
--    ondespawn()  — called when removed from the world, before final teardown.
--    _dispose()   — object-owned final teardown after world removal; calls unbind() which removes all event
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
--          eventemitter:remove_subscriber(self)  -- base
--          -- additional cleanup ...
--      end
--
-- 3. NEVER CALL METHODS ON OTHER OBJECTS DIRECTLY FROM bind().
--    Subscriptions in bind() establish reactive wiring.  Do not reach into
--    other objects to mutate their state at bind()-time.  Emit an event and
--    let the other object respond, or use component activation for
--    initialisation that must happen on activate.
--
-- 4. DISPOSAL THROUGH THE OBJECT'S WORLD.
--    self:mark_for_disposal() is the public terminal-lifecycle command. The
--    world commits the removal at the current tick-group barrier, or directly
--    when no group is active. `ondespawn()` remains the removal lifecycle hook;
--    `_dispose()` is the object-owned final component and subscription teardown
--    called by world after that removal.
--
-- 5. set_space() IS NOT despawn.
--    Moving an object to a non-active space removes it from the selected
--    space's retained system views without destroying it. Components and
--    subscriptions persist until the object's space is selected again.
local componentclass<const> = require('cartlib/component/componentclass')
local eventemitter<const> = require('cartlib/eventemitter')

local worldobject<const> = {}
worldobject.__index = worldobject

function worldobject.new(opts)
	local self<const> = setmetatable({}, worldobject)
	self.definition_id = opts.definition_id
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
	self._components_by_class = {}
	self._bound = false
	self.space_id = opts.space_id
	self.events = eventemitter.events_of(self)
	return self
end

-- set_pos(x, y, z?): sets world position. Each component falls back to the
-- current value when nil, so set_pos(x, y) preserves the current z.
function worldobject:set_pos(x, y, z)
	self.x = x or self.x
	self.y = y or self.y
	if z ~= nil then
		self:set_z(z)
	end
end

function worldobject:set_z(z)
	self.z = z
	if self._worldobject_index ~= nil then
		self.world:visual_depth_changed()
	end
end

-- set_space(space_id): moves this object into the named world space.
--   The object stays alive and subscribed. Its components and definition stop
--   appearing in retained views while another space is selected, then reappear
--   when its own space becomes active again.
function worldobject:set_space(space_id)
	return self.world:set_object_space(self, space_id)
end

-- add_component(comp): attach a component to this object.
-- Returns the component for chaining.  Components are updated by ECS systems,
-- as the object lacks its own update() method.
function worldobject:add_component(comp)
	local component_class<const> = getmetatable(comp)
	local classes<const> = componentclass.chain(component_class)
	local components_by_class<const> = self._components_by_class
	for class_index = 1, #classes do
		local class<const> = classes[class_index]
		local bucket<const> = components_by_class[class]
		if rawget(class, 'unique') and bucket ~= nil then
			for component_index = 1, #bucket do
				if bucket[component_index]._attached then
					error('unique component already attached to "' .. self.id .. '"')
				end
			end
		end
	end
	comp.parent = self
	comp._attached = true
	local components<const> = self._components
	local component_index<const> = #components + 1
	components[component_index] = comp
	comp._parent_component_index = component_index
	for class_index = 1, #classes do
		local class<const> = classes[class_index]
		local bucket = components_by_class[class]
		if bucket == nil then
			bucket = {}
			components_by_class[class] = bucket
		end
		local bucket_index<const> = #bucket + 1
		bucket[bucket_index] = comp
		if class_index == 1 then
			comp._parent_class_index = bucket_index
		end
	end
	comp:on_attach()
	if self._worldobject_index ~= nil then
		self.world:attach_component(comp)
	end
	if self.active then
		comp:on_activate()
	end

	return comp
end

function worldobject:get_component(component_class)
	local list<const> = self._components_by_class[component_class]
	return list and list[1]
end

function worldobject:remove_component(comp)
	comp._attached = false
	if self._worldobject_index ~= nil then
		self.world:detach_component(comp)
	else
		self:_commit_component_detach(comp)
	end
end

function worldobject:_commit_component_detach(comp)
	local component_class<const> = getmetatable(comp)
	local classes<const> = componentclass.chain(component_class)
	local components_by_class<const> = self._components_by_class
	for chain_index = 1, #classes do
		local class<const> = classes[chain_index]
		local list<const> = components_by_class[class]
		local class_index
		if chain_index == 1 then
			class_index = comp._parent_class_index
		else
			for index = 1, #list do
				if list[index] == comp then
					class_index = index
					break
				end
			end
		end
		local last_class_index<const> = #list
		if class_index < last_class_index then
			local moved<const> = list[last_class_index]
			list[class_index] = moved
			if getmetatable(moved) == class then
				moved._parent_class_index = class_index
			end
		end
		list[last_class_index] = nil
		if last_class_index == 1 then
			components_by_class[class] = nil
		end
	end
	comp._parent_class_index = nil

	local components<const> = self._components
	local component_index<const> = comp._parent_component_index
	local last_component_index<const> = #components
	if component_index < last_component_index then
		local moved<const> = components[last_component_index]
		components[component_index] = moved
		moved._parent_component_index = component_index
	end
	components[last_component_index] = nil
	comp._parent_component_index = nil
	comp:on_detach()
	comp:unbind()
end

-- has_tag(tag): returns true if this object currently carries the given tag.
-- Tags are plain-string keys set on self.tags.  The FSM also manages tags
-- automatically through state `tags` declarations and timeline windows.
function worldobject:has_tag(tag)
	return (self.tags[tag])
end

function worldobject:add_tag(tag)
	if not self.tags[tag] then
		self.tags[tag] = true
		if self._worldobject_index ~= nil then
			self.world:reconcile_object_tag(self, tag)
		end
	end
end

function worldobject:remove_tag(tag)
	if self.tags[tag] then
		self.tags[tag] = nil
		if self._worldobject_index ~= nil then
			self.world:reconcile_object_tag(self, tag)
		end
	end
end

function worldobject:toggle_tag(tag)
	if self.tags[tag] then
		self:remove_tag(tag)
	else
		self:add_tag(tag)
	end
end

-- activate(): called by world:spawn() after onspawn(). Sets active = true,
-- binds a new object once, then activates the components that were already attached.
-- Components added during bind activate through add_component() exactly once.
-- Do not call directly; spawn the object through the world instead.
function worldobject:activate()
	if self.marked_for_disposal then
		return
	end
	local components<const> = self._components
	local component_count<const> = #components
	self.active = true
	if self._worldobject_index ~= nil then
		self.world:reconcile_object(self)
	end
	if not self._bound then
		self._bound = true
		self:bind()
	end
	if not self.active then
		return
	end
	for i = 1, component_count do
		components[i]:on_activate()
	end
end

-- bind(): override in subclasses to register event subscriptions.
-- Called once by the first activate() before attached components activate. Always set
-- `subscriber = self` on every subscription so unbind() cleans them up.
function worldobject:bind()
end

-- unbind(): removes all event subscriptions whose subscriber == self.
-- Called by _dispose().  Override only if you need extra teardown beyond
-- event unsubscription; in that case call the base implementation first.
function worldobject:unbind()
	eventemitter:remove_subscriber(self)
end

-- deactivate(): removes the object and its components from active scheduling
-- without removing it from the world. Component state and event subscriptions
-- are preserved. Disposal commits remove the same membership directly before
-- the object's despawn callback runs.
-- Do not override; instead react to the 'despawn' event.
function worldobject:deactivate()
	self.active = false
	if self._worldobject_index ~= nil then
		self.world:reconcile_object(self)
	end
end

-- onspawn(pos): called by world:spawn() after position is set from pos.
-- Override for spawn-time setup.  Position (x, y, z) is already applied.
-- activate(), bind(), component activation, and the 'spawn' event are handled
-- automatically by world:spawn() after this returns — no super call needed.
function worldobject:onspawn(pos)
end

-- ondespawn(): called after world, space, Registry, and active membership have
-- been removed, while components and event state are still intact. Override
-- for despawn-specific cleanup; call the supermethod to emit 'despawn'.
function worldobject:ondespawn()
	self.events:emit('despawn')
end

-- mark_for_disposal(): requests terminal removal from the world and deactivates
-- the object before the structural removal commit. The world owns that commit,
-- so this remains safe from update and event code.
function worldobject:mark_for_disposal()
	self.world:mark_for_disposal(self)
end

-- _dispose(): object teardown invoked only after world has removed Registry,
-- space, and active membership. Cart code requests that transition through
-- mark_for_disposal(); it never tears down a live object directly.
function worldobject:_dispose()
	local components<const> = self._components
	for i = #components, 1, -1 do
		local component<const> = components[i]
		component._attached = false
		self:_commit_component_detach(component)
	end
	self:unbind()
end

return worldobject
