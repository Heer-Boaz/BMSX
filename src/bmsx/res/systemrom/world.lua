-- world.lua
-- minimal lua world manager for system rom

local ecs = require("ecs")
local ecs_pipeline = require("ecs_pipeline")

local tickgroup = ecs.tickgroup

local world = {}
world.__index = world

function world.new()
	local self = setmetatable({}, world)
	self._objects = {}
	self._by_id = {}
	self.systems = ecs.ecsystemmanager.new()
	self.current_phase = nil
	self.paused = false
	self.gamewidth = display_width()
	self.gameheight = display_height()
	return self
end

function world:configure_pipeline(nodes)
	return ecs_pipeline.defaultecspipelineregistry:build(self, nodes)
end

function world:apply_default_pipeline()
	local ecs_builtin = require("ecs_builtin")
	ecs_builtin.register_builtin_ecs()
	return self:configure_pipeline(ecs_builtin.default_pipeline_spec())
end

function world:spawn(obj, pos)
	self._by_id[obj.id] = obj
	self._objects[#self._objects + 1] = obj
	obj:onspawn(pos)
	return obj
end

function world:despawn(id_or_obj)
	local obj = id_or_obj
	if type(id_or_obj) ~= "table" then
		obj = self._by_id[id_or_obj]
	end
	obj:ondespawn()
	obj:dispose()
	self._by_id[obj.id] = nil
	for i = #self._objects, 1, -1 do
		if self._objects[i] == obj then
			table.remove(self._objects, i)
			break
		end
	end
end

function world:get(id)
	return self._by_id[id]
end

function world:objects(opts)
	local scope = opts and opts.scope or "all"
	local reverse = opts and opts.reverse or false
	local index = reverse and (#self._objects + 1) or 0
	return function()
		while true do
			index = index + (reverse and -1 or 1)
			local obj = self._objects[index]
			if not obj then
				return nil
			end
			if scope == "active" then
				if obj.active then
					return obj
				end
			else
				return obj
			end
		end
	end
end

function world:objects_with_components(type_name, opts)
	local scope = opts and opts.scope or "all"
	local obj_index = 0
	local comp_index = 0
	local comp_list = nil
	local current_obj = nil

	return function()
		while true do
			if not comp_list or comp_index >= #comp_list then
				comp_list = nil
				comp_index = 0
				obj_index = obj_index + 1
				current_obj = self._objects[obj_index]
				if not current_obj then
					return nil
				end
				if scope == "active" and not current_obj.active then
					current_obj = nil
				else
					comp_list = current_obj:get_components(type_name)
					if #comp_list == 0 then
						comp_list = nil
						current_obj = nil
					end
				end
			else
				comp_index = comp_index + 1
				local comp = comp_list[comp_index]
				if comp then
					return current_obj, comp
				end
				comp_list = nil
				current_obj = nil
			end
		end
	end
end

function world:update(dt)
	self.deltatime = dt
	self.systems:begin_frame()
	self.current_phase = tickgroup.input
	self.systems:update_phase(self, tickgroup.input)
	self.current_phase = tickgroup.actioneffect
	self.systems:update_phase(self, tickgroup.actioneffect)
	self.current_phase = tickgroup.moderesolution
	self.systems:update_phase(self, tickgroup.moderesolution)
	self.current_phase = tickgroup.physics
	self.systems:update_phase(self, tickgroup.physics)
	self.current_phase = tickgroup.animation
	self.systems:update_phase(self, tickgroup.animation)
	self.current_phase = nil

	for i = #self._objects, 1, -1 do
		local obj = self._objects[i]
		if obj._dispose_flag then
			self._by_id[obj.id] = nil
			obj:ondespawn()
			obj:dispose()
			table.remove(self._objects, i)
		end
	end
end

function world:draw()
	self.current_phase = tickgroup.presentation
	self.systems:update_phase(self, tickgroup.presentation)
	self.current_phase = tickgroup.eventflush
	self.systems:update_phase(self, tickgroup.eventflush)
	self.current_phase = nil
end

function world:clear()
	for i = #self._objects, 1, -1 do
		self._objects[i]:dispose()
	end
	self._objects = {}
	self._by_id = {}
end

return {
	world = world,
	instance = world.new(),
}
