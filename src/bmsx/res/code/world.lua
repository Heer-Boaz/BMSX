-- world.lua
-- Minimal Lua world manager for system ROM

local World = {}
World.__index = World

function World.new()
	local self = setmetatable({}, World)
	self.objects = {}
	self.by_id = {}
	return self
end

function World:spawn(obj, pos)
	self.by_id[obj.id] = obj
	self.objects[#self.objects + 1] = obj
	obj:onspawn(pos)
	return obj
end

function World:despawn(id_or_obj)
	local obj = id_or_obj
	if type(id_or_obj) ~= "table" then
		obj = self.by_id[id_or_obj]
	end
	obj:ondespawn()
	obj:dispose()
	self.by_id[obj.id] = nil
	for i = #self.objects, 1, -1 do
		if self.objects[i] == obj then
			table.remove(self.objects, i)
			break
		end
	end
end

function World:get(id)
	return self.by_id[id]
end

function World:update(dt)
	for i = #self.objects, 1, -1 do
		local obj = self.objects[i]
		if obj._dispose_flag then
			self.by_id[obj.id] = nil
			obj:ondespawn()
			obj:dispose()
			table.remove(self.objects, i)
		elseif obj.active then
			obj.timelines:tick_active(dt)
			obj.sc:tick(dt)
			if obj.tick_enabled then
				obj:tick(dt)
			end
			for _, comp in ipairs(obj.components) do
				if comp.enabled then
					comp:tick(dt)
				end
			end
		end
	end
end

function World:draw()
	table.sort(self.objects, function(a, b) return a.z < b.z end)
	for i = 1, #self.objects do
		local obj = self.objects[i]
		if obj.visible then
			obj:draw()
			for _, comp in ipairs(obj.components) do
				if comp.enabled then
					comp:draw()
				end
			end
		end
	end
end

function World:clear()
	for i = #self.objects, 1, -1 do
		self.objects[i]:dispose()
	end
	self.objects = {}
	self.by_id = {}
end

return {
	World = World,
	instance = World.new(),
}
