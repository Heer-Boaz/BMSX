-- worldobject.lua
-- Minimal world object base for system ROM

local eventemitter = require("eventemitter")
local fsm = require("fsm")
local fsmlibrary = require("fsmlibrary")
local components = require("components")
local behaviourtree = require("behaviourtree")

local WorldObject = {}
WorldObject.__index = WorldObject

local function component_key(type_or_name)
	local t = type(type_or_name)
	if t == "string" then
		return string.lower(type_or_name)
	end
	if t == "table" then
		local name = type_or_name.type_name or type_or_name.typename or type_or_name.name
		return string.lower(name or "")
	end
	return string.lower(tostring(type_or_name))
end

function WorldObject.new(opts)
	local self = setmetatable({}, WorldObject)
	opts = opts or {}
	self.id = opts.id or "worldobject"
	self.type_name = "WorldObject"
	self.x = opts.x or 0
	self.y = opts.y or 0
	self.z = opts.z or 0
	self.sx = opts.sx or 0
	self.sy = opts.sy or 0
	self.sz = opts.sz or 0
	self.visible = opts.visible ~= false
	self.active = opts.active or false
	self.tick_enabled = opts.tick_enabled or false
	self.eventhandling_enabled = opts.eventhandling_enabled or false
	self.player_index = opts.player_index or 1
	self.components = {}
	self.component_map = {}
	self.space_id = opts.space_id
	self._dispose_flag = false
	self.dispose_flag = false
	self._disposed = false
	self.events = eventemitter.events_of(self)
	local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.StateMachineController.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	self.btreecontexts = {}

	self.timelines = components.TimelineComponent.new({ parent = self })
	self:add_component(self.timelines)
	return self
end

function WorldObject:set_pos(x, y, z)
	self.x = x or self.x
	self.y = y or self.y
	self.z = z or self.z
end

function WorldObject:move_by(dx, dy, dz)
	self.x = self.x + (dx or 0)
	self.y = self.y + (dy or 0)
	self.z = self.z + (dz or 0)
end

function WorldObject:add_component(comp)
	comp.parent = self
	local key = component_key(comp.type_name or comp)
	local bucket = self.component_map[key]
	if not bucket then
		bucket = {}
		self.component_map[key] = bucket
	end
	if comp.unique and #bucket > 0 then
		error("Component '" .. (comp.type_name or key) .. "' is unique and already attached to '" .. self.id .. "'")
	end
	table.insert(self.components, comp)
	bucket[#bucket + 1] = comp
	comp:bind()
	comp:on_attach()
	if comp.type_name == "TimelineComponent" then
		self.timelines = comp
	end
	if comp.type_name == "ActionEffectComponent" then
		self.actioneffects = comp
	end
	return comp
end

function WorldObject:get_component(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	return list and list[1] or nil
end

function WorldObject:get_components(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	local out = {}
	if list then
		for i = 1, #list do
			out[i] = list[i]
		end
	end
	return out
end

function WorldObject:get_unique_component(type_name)
	local list = self.component_map[component_key(type_name)]
	if not list or #list == 0 then
		return nil
	end
	if #list > 1 then
		error("Multiple '" .. component_key(type_name) .. "' components attached to '" .. self.id .. "'")
	end
	return list[1]
end

function WorldObject:has_component(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	return list and #list > 0
end

function WorldObject:get_component_by_id(id)
	for _, c in ipairs(self.components) do
		if c.id == id or c.id_local == id then
			return c
		end
	end
	return nil
end

function WorldObject:get_component_by_local_id(type_name, id_local)
	for _, c in ipairs(self.components) do
		if c.id_local == id_local and component_key(c.type_name) == component_key(type_name) then
			return c
		end
	end
	return nil
end

function WorldObject:get_component_at(type_name, index)
	local list = self.component_map[component_key(type_name)]
	return list and list[index + 1] or nil
end

function WorldObject:find_component(predicate, type_name)
	local list = type_name and self:get_components(type_name) or self.components
	for i = 1, #list do
		local c = list[i]
		if predicate(c, i) then
			return c
		end
	end
	return nil
end

function WorldObject:find_components(predicate, type_name)
	local list = type_name and self:get_components(type_name) or self.components
	local out = {}
	for i = 1, #list do
		local c = list[i]
		if predicate(c, i) then
			out[#out + 1] = c
		end
	end
	return out
end

function WorldObject:remove_components(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	if not list then
		return
	end
	for i = #list, 1, -1 do
		self:remove_component_instance(list[i])
	end
end

function WorldObject:remove_component_instance(comp)
	local key = component_key(comp.type_name or comp)
	local list = self.component_map[key]
	if list then
		for i = #list, 1, -1 do
			if list[i] == comp then
				table.remove(list, i)
				break
			end
		end
		if #list == 0 then
			self.component_map[key] = nil
		end
	end
	for i = #self.components, 1, -1 do
		if self.components[i] == comp then
			table.remove(self.components, i)
			break
		end
	end
	comp:on_detach()
	comp:unbind()
	comp.parent = nil
end

function WorldObject:remove_all_components()
	for i = #self.components, 1, -1 do
		self:remove_component_instance(self.components[i])
	end
end

function WorldObject:iterate_components()
	return ipairs(self.components)
end

function WorldObject:activate()
	self.active = true
	self.tick_enabled = true
	self.eventhandling_enabled = true
	self.sc:resume()
	self.sc:start()
end

function WorldObject:deactivate()
	self.active = false
	self.tick_enabled = false
	self.eventhandling_enabled = false
	self.sc:pause()
end

function WorldObject:onspawn(pos)
	if pos then
		self.x = pos.x or self.x
		self.y = pos.y or self.y
		self.z = pos.z or self.z
	end
	self:activate()
	self.events:emit("spawn", { pos = pos })
end

function WorldObject:ondespawn()
	self.active = false
	self.eventhandling_enabled = false
	self.events:emit("despawn")
end

function WorldObject:mark_for_disposal()
	self._dispose_flag = true
	self.dispose_flag = true
	self:deactivate()
end

function WorldObject:dispose()
	self._disposed = true
	self:deactivate()
	self:remove_all_components()
	self.sc:dispose()
	eventemitter.EventEmitter.instance:remove_subscriber(self)
end

function WorldObject:tick(_dt)
end

function WorldObject:draw()
end

function WorldObject:define_timeline(def)
	self.timelines:define(def)
end

function WorldObject:play_timeline(id, opts)
	self.timelines:play(id, opts)
end

function WorldObject:stop_timeline(id)
	self.timelines:stop(id)
end

function WorldObject:get_timeline(id)
	return self.timelines:get(id)
end

function WorldObject:add_btree(bt_id)
	if self.btreecontexts[bt_id] then
		return
	end
	local blackboard = behaviourtree.Blackboard.new({ id = bt_id })
	self.btreecontexts[bt_id] = {
		tree_id = bt_id,
		running = true,
		root = behaviourtree.instantiate(bt_id),
		blackboard = blackboard,
	}
end

function WorldObject:tick_tree(bt_id)
	local context = self.btreecontexts[bt_id]
	if not context then
		error("Behavior tree context '" .. bt_id .. "' does not exist.")
	end
	if not context.running then
		return
	end
	context.root:tick(self, context.blackboard)
end

function WorldObject:reset_tree(bt_id)
	local context = self.btreecontexts[bt_id]
	if not context then
		error("Behavior tree context '" .. bt_id .. "' does not exist.")
	end
	context.blackboard:clear_node_data()
end

return WorldObject
