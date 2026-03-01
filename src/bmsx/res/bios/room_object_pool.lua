local room_object_pool = {}
room_object_pool.__index = room_object_pool

local function activate_main(instance)
	instance:set_space('main')
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
end

local function deactivate_instance(instance)
	instance.visible = false
	if instance.active then
		instance:deactivate()
	end
end

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

function room_object_pool:begin_cycle()
	clear_map(self.active_ids)
end

function room_object_pool:use(definition, context)
	local id = definition.id
	local instance = object(id)
	local was_missing = instance == nil
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

function room_object_pool:end_cycle()
	for id in pairs(self.instances_by_id) do
		local instance = object(id)
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
	local instance = object(id)
	if instance ~= nil then
		self.deactivate_instance(instance, id)
	end
end

function room_object_pool:sync_array(definitions, include_definition, context)
	self:begin_cycle()
	for i = 1, #definitions do
		local definition = definitions[i]
		if include_definition == nil or include_definition(definition, context) then
			self:use(definition, context)
		end
	end
	self:end_cycle()
end

return room_object_pool
