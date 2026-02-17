local eventemitter = require("eventemitter")
local fsm = require("fsm")
local fsmlibrary = require("fsmlibrary")
local components = require("components")
local behaviourtree = require("behaviourtree")
local world_instance = require("world").instance

local worldobject = {}
worldobject.__index = worldobject

local world_id_max = 2147483647

local function component_key(type_or_name)
	local t = type(type_or_name)
	if t == "string" then
		return string.lower(type_or_name)
	end
	if t == "table" then
		local name = type_or_name.type_name or type_or_name.typename or type_or_name.name
		return string.lower(name or '')
	end
	return string.lower(tostring(type_or_name))
end

function worldobject.new(opts)
	opts = opts or {}
	local self = setmetatable({}, worldobject)
	self.type_name = opts.type_name or 'worldobject'
	self.id = opts.id or self:generate_id()
	self.x = opts.x or 0
	self.y = opts.y or 0
	self.z = opts.z or 0
	self.sx = opts.sx or 0
	self.sy = opts.sy or 0
	self.sz = opts.sz or 0
	self.visible = opts.visible ~= false
	self.active = false
	self.tick_enabled = false
	self.eventhandling_enabled = false
	self.player_index = opts.player_index
	self.tags = opts.tags or {}
	self.components = {}
	self.component_map = {}
	self.space_id = opts.space_id
	self.dispose_flag = false
	self.events = eventemitter.events_of(self)
	local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	self.btreecontexts = {}

	self.timelines = components.timelinecomponent.new({ parent = self })
	self:add_component(self.timelines)
	return self
end

function worldobject:generate_id()
	local baseid = self.type_name
	local uniquenumber = world_instance.idcounter + 1
	if uniquenumber >= world_id_max then
		uniquenumber = 1
	end

	local result = baseid .. "_" .. tostring(uniquenumber)
	while world_instance._by_id[result] ~= nil do
		uniquenumber = uniquenumber + 1
		if uniquenumber >= world_id_max then
			uniquenumber = 1
		end
		result = baseid .. "_" .. tostring(uniquenumber)
	end

	world_instance.idcounter = uniquenumber
	return result
end

function worldobject:set_pos(x, y, z)
	self.x = x or self.x
	self.y = y or self.y
	self.z = z or self.z
end

function worldobject:move_by(dx, dy, dz)
	self.x = self.x + (dx or 0)
	self.y = self.y + (dy or 0)
	self.z = self.z + (dz or 0)
end

function worldobject:add_component(comp)
	comp.parent = self
	local key = component_key(comp.type_name or comp)
	local bucket = self.component_map[key]
	if not bucket then
		bucket = {}
		self.component_map[key] = bucket
	end
	if comp.unique and #bucket > 0 then
		error("component '" .. (comp.type_name or key) .. "' is unique and already attached to '" .. self.id .. "'")
	end
	table.insert(self.components, comp)
	bucket[#bucket + 1] = comp
	comp:bind()
	comp:on_attach()
	if comp.type_name == "timelinecomponent" then
		self.timelines = comp
	end
	if comp.type_name == "actioneffectcomponent" then
		self.actioneffects = comp
	end
	if comp.type_name == "abilitiescomponent" then
		self.abilities = comp
	end

	return comp
end

function worldobject:get_component(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	return list and list[1] or nil
end

function worldobject:get_components(type_name)
	local key = component_key(type_name)
	return self.component_map[key] or {}
end

function worldobject:get_unique_component(type_name)
	local list = self.component_map[component_key(type_name)]
	if not list or #list == 0 then
		return nil
	end
	if #list > 1 then
		error("multiple '" .. component_key(type_name) .. "' components attached to '" .. self.id .. "'")
	end
	return list[1]
end

function worldobject:has_component(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	return list and #list > 0
end

function worldobject:get_component_by_id(id)
	for _, c in ipairs(self.components) do
		if c.id == id or c.id_local == id then
			return c
		end
	end
	return nil
end

function worldobject:get_component_by_local_id(type_name, id_local)
	for _, c in ipairs(self.components) do
		if c.id_local == id_local and component_key(c.type_name) == component_key(type_name) then
			return c
		end
	end
	return nil
end

function worldobject:get_component_at(type_name, index)
	local list = self.component_map[component_key(type_name)]
	return list and list[index + 1] or nil
end

function worldobject:find_component(predicate, type_name)
	local list = type_name and self:get_components(type_name) or self.components
	for i = 1, #list do
		local c = list[i]
		if predicate(c, i) then
			return c
		end
	end
	return nil
end

function worldobject:find_components(predicate, type_name)
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

function worldobject:remove_components(type_name)
	local key = component_key(type_name)
	local list = self.component_map[key]
	if not list then
		return
	end
	for i = #list, 1, -1 do
		self:remove_component_instance(list[i])
	end
end

function worldobject:remove_component_instance(comp)
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

function worldobject:remove_all_components()
	for i = #self.components, 1, -1 do
		self:remove_component_instance(self.components[i])
	end
end

function worldobject:iterate_components()
	return ipairs(self.components)
end

function worldobject:has_tag(tag)
	return self.tags[tag] == true
end

function worldobject:add_tag(tag)
	self.tags[tag] = true
end

function worldobject:remove_tag(tag)
	self.tags[tag] = nil
end

function worldobject:toggle_tag(tag)
	self.tags[tag] = not self.tags[tag]
end

-- Forwards an event to the FSM, which can be used for state transitions or as a general-purpose event bus for the worldobject's internal logic. The event can be a string (event type) or a table (event object). If it's a string, it will be wrapped in a table with the type and emitter fields.
function worldobject:dispatch_state_event(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

-- Useless alias for dispatch_state_event, but provided for semantic clarity in some cases, so that Codex can recognize the intent as dispatching a command rather than a gameplay fact.
function worldobject:dispatch_command(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

function worldobject:emit_gameplay_fact(event_or_name, payload)
	local event = event_or_name
	if type(event_or_name) ~= "table" then
		local spec = { type = event_or_name, emitter = self }
		if payload ~= nil then
			if type(payload) == "table" and payload.type == nil then
				for k, v in pairs(payload) do
					spec[k] = v
				end
			else
				spec.payload = payload
			end
		end
		event = eventemitter.eventemitter.instance:create_gameevent(spec)
	elseif event.emitter == nil then
		event.emitter = self
	end
	self.events:emit_event(event)
	self.sc:dispatch(event)
	return event
end

function worldobject:activate()
	self.active = true
	self.tick_enabled = true
	self.eventhandling_enabled = true
	self.sc:resume()
	self.sc:start()
end

function worldobject:deactivate()
	self.active = false
	self.tick_enabled = false
	self.eventhandling_enabled = false
	self.sc:pause()
end

function worldobject:onspawn(pos)
	if pos then
		self.x = pos.x or self.x
		self.y = pos.y or self.y
		self.z = pos.z or self.z
	end
	self:activate()
	self.events:emit("spawn", { pos = pos })
end

function worldobject:ondespawn()
	self.active = false
	self.eventhandling_enabled = false
	self.events:emit("despawn")
end

function worldobject:mark_for_disposal()
	self.dispose_flag = true
	self:deactivate()
end

function worldobject:dispose()
	self:deactivate()
	self:remove_all_components()
	self.sc:dispose()
	eventemitter.eventemitter.instance:remove_subscriber(self)
end

function worldobject:tick()
end

function worldobject:draw()
end

function worldobject:define_timeline(def)
	self.timelines:define(def)
end

function worldobject:play_timeline(id, opts)
	self.timelines:play(id, opts)
end

function worldobject:stop_timeline(id)
	self.timelines:stop(id)
end

function worldobject:get_timeline(id)
	return self.timelines:get(id)
end

function worldobject:seek_timeline(id, frame)
	return self.timelines:seek(id, frame)
end

function worldobject:force_seek_timeline(id, frame)
	return self.timelines:force_seek(id, frame)
end

function worldobject:advance_timeline(id)
	return self.timelines:advance(id)
end

function worldobject:add_btree(bt_id)
	if self.btreecontexts[bt_id] then
		return
	end
	local blackboard = behaviourtree.blackboard.new({ id = bt_id })
	self.btreecontexts[bt_id] = {
		tree_id = bt_id,
		running = true,
		root = behaviourtree.instantiate(bt_id),
		blackboard = blackboard,
	}
end

function worldobject:tick_tree(bt_id)
	local context = self.btreecontexts[bt_id]
	if not context then
		error("behavior tree context '" .. bt_id .. "' does not exist.")
	end
	if not context.running then
		return
	end
	context.root:tick(self, context.blackboard)
end

function worldobject:reset_tree(bt_id)
	local context = self.btreecontexts[bt_id]
	if not context then
		error("behavior tree context '" .. bt_id .. "' does not exist.")
	end
	context.blackboard:clear_node_data()
end

return worldobject
