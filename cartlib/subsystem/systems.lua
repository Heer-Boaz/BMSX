local ecs<const> = require('cartlib/ecs/index')

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local subsystemupdatesystem<const> = {}
subsystemupdatesystem.__index = subsystemupdatesystem
setmetatable(subsystemupdatesystem, { __index = ecsystem })

function subsystemupdatesystem.new(owner)
	-- Subsystem scheduling lives on the subsystem itself. Keep bind-time system
	-- creation dumb and direct instead of re-resolving fallback policy here.
	local self<const> = setmetatable(ecsystem.new(owner.update_group, owner.update_priority), subsystemupdatesystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_update:' .. owner.id
	self.name = 'subsystem_update:' .. owner.id
	self.id = 'ecs:subsystem_update:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystemupdatesystem:update(dt_ms)
	local owner<const> = self.owner
	if not owner.active then
		return
	end
	owner.sc:update(dt_ms)
end

local subsystemanimationsystem<const> = {}
subsystemanimationsystem.__index = subsystemanimationsystem
setmetatable(subsystemanimationsystem, { __index = ecsystem })

function subsystemanimationsystem.new(owner)
	local self<const> = setmetatable(ecsystem.new(tickgroup.animation, owner.animation_priority), subsystemanimationsystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_animation:' .. owner.id
	self.name = 'subsystem_animation:' .. owner.id
	self.id = 'ecs:subsystem_animation:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystemanimationsystem:update(dt_ms)
	local owner<const> = self.owner
	if not owner.active then
		return
	end
	owner.timelines:update(dt_ms)
end

local subsystempresentationsystem<const> = {}
subsystempresentationsystem.__index = subsystempresentationsystem
setmetatable(subsystempresentationsystem, { __index = ecsystem })

function subsystempresentationsystem.new(owner)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, owner.presentation_priority), subsystempresentationsystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_presentation:' .. owner.id
	self.name = 'subsystem_presentation:' .. owner.id
	self.id = 'ecs:subsystem_presentation:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystempresentationsystem:update()
	local owner<const> = self.owner
	if not owner.active or not owner.visible then
		return
	end
	owner:draw()
end

local create_presentation_system<const> = function(owner)
	if owner.draw == nil then
		return nil
	end
	return subsystempresentationsystem.new(owner)
end

return {
	create_update_system = subsystemupdatesystem.new,
	create_animation_system = subsystemanimationsystem.new,
	create_presentation_system = create_presentation_system,
}
