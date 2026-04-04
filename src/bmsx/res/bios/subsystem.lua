local eventemitter<const> = require('eventemitter')
local fsm<const> = require('fsm')
local fsmlibrary<const> = require('fsmlibrary')
local ecs<const> = require('ecs')
local subsystem_timeline_module<const> = require('subsystem_timelines')
local world_instance<const> = require('world').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem
local subsystemtimelines<const> = subsystem_timeline_module.subsystemtimelines

local subsystem<const> = {}
subsystem.__index = subsystem

local subsystem_group_lookup<const> = {}
for _, value in pairs(tickgroup) do
	subsystem_group_lookup[value] = true
end

local subsystem_id_max<const> = 0x7fffffff

local generate_subsystem_id<const> = function(type_name)
	local baseid<const> = type_name or 'subsystem'
	local uniquenumber = world_instance.idcounter + 1
	if uniquenumber >= subsystem_id_max then
		uniquenumber = 1
	end

	local result = baseid .. '_' .. tostring(uniquenumber)
	while world_instance._by_id[result] ~= nil or world_instance._subsystems_by_id[result] ~= nil do
		uniquenumber = uniquenumber + 1
		if uniquenumber >= subsystem_id_max then
			uniquenumber = 1
		end
		result = baseid .. '_' .. tostring(uniquenumber)
	end

	world_instance.idcounter = uniquenumber
	return result
end

local resolve_update_group<const> = function(owner)
	local group<const> = owner.update_group
	if group == nil then
		return tickgroup.moderesolution
	end
	if subsystem_group_lookup[group] then
		return group
	end
	error('[subsystem] invalid update_group "' .. tostring(group) .. '" on subsystem "' .. tostring(owner.id) .. '".')
end

function subsystem.new(opts)
	opts = opts or {}
	local self<const> = setmetatable({}, subsystem)
	self.type_name = opts.type_name or 'subsystem'
	self.id = opts.id or generate_subsystem_id(self.type_name)
	self.active = false
	self.update_enabled = false
	self.fsm_dispatch_enabled = false
	self.visible = true
	if opts.visible ~= nil then
		self.visible = opts.visible
	end
	self.presentation_enabled = true
	if opts.presentation_enabled ~= nil then
		self.presentation_enabled = opts.presentation_enabled
	end
	self.player_index = opts.player_index
	self.tags = opts.tags or {}
	self.dispose_flag = false
	self.is_subsystem = true
	self.events = eventemitter.events_of(self)
	local definition<const> = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	self.timelines = subsystemtimelines.new(self)
	self.update_group = opts.update_group or tickgroup.moderesolution
	self.update_priority = opts.update_priority or 0
	self.animation_priority = opts.animation_priority or self.update_priority
	self.presentation_priority = opts.presentation_priority or 0
	return self
end

function subsystem:has_tag(tag)
	return self.tags[tag]
end

function subsystem:add_tag(tag)
	self.tags[tag] = true
end

function subsystem:remove_tag(tag)
	self.tags[tag] = nil
end

function subsystem:toggle_tag(tag)
	self.tags[tag] = not self.tags[tag]
end

function subsystem:dispatch_state_event(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

function subsystem:dispatch_command(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

function subsystem:emit_gameplay_fact(event_or_name, payload)
	local event
	if type(event_or_name) ~= 'table' then
		local spec<const> = { type = event_or_name, emitter = self, payload = payload }
		event = eventemitter.eventemitter.instance:create_gameevent(spec)
	else
		event = event_or_name
		if event.emitter == nil then
			event.emitter = self
		end
	end
	self.events:emit_event(event)
	self.sc:dispatch(event)
	return event
end

function subsystem:activate()
	self.active = true
	self.update_enabled = true
	self.fsm_dispatch_enabled = true
	self:bind()
	self.sc:start()
end

function subsystem:deactivate()
	self.active = false
	self.update_enabled = false
	self.fsm_dispatch_enabled = false
	self.sc:pause()
end

function subsystem:bind()
end

function subsystem:unbind()
	eventemitter.eventemitter.instance:remove_subscriber(self)
end

function subsystem:onregister()
end

function subsystem:onderegister()
	self:deactivate()
	self.events:emit('despawn')
end

function subsystem:mark_for_disposal()
	self.dispose_flag = true
	self:deactivate()
end

function subsystem:dispose()
	self:deactivate()
	self.timelines:dispose()
	self.sc:dispose()
	registry.instance:deregister(self, true)
	self:unbind()
end

function subsystem:define_timeline(definition)
	self.timelines:define(definition)
end

function subsystem:play_timeline(id, opts)
	self.timelines:play(id, opts)
end

function subsystem:stop_timeline(id)
	self.timelines:stop(id)
end

function subsystem:get_timeline(id)
	return self.timelines:get(id)
end

function subsystem:seek_timeline(id, frame)
	return self.timelines:seek(id, frame)
end

function subsystem:force_seek_timeline(id, frame)
	return self.timelines:force_seek(id, frame)
end

function subsystem:advance_timeline(id)
	return self.timelines:advance(id)
end

function subsystem:set_update_schedule(group, priority)
	self.update_group = group or self.update_group
	if priority ~= nil then
		self.update_priority = priority
	end
	if world_instance:get_subsystem(self.id) == self then
		world_instance:rebind_subsystem_systems(self)
	end
end

function subsystem:set_animation_priority(priority)
	if priority == nil then
		return
	end
	self.animation_priority = priority
	if world_instance:get_subsystem(self.id) == self then
		world_instance:rebind_subsystem_systems(self)
	end
end

function subsystem:set_presentation_priority(priority)
	if priority == nil then
		return
	end
	self.presentation_priority = priority
	if world_instance:get_subsystem(self.id) == self then
		world_instance:rebind_subsystem_systems(self)
	end
end

function subsystem:set_presentation_enabled(enabled)
	self.presentation_enabled = enabled
	if world_instance:get_subsystem(self.id) == self then
		world_instance:rebind_subsystem_systems(self)
	end
end

local subsystemupdatesystem<const> = {}
subsystemupdatesystem.__index = subsystemupdatesystem
setmetatable(subsystemupdatesystem, { __index = ecsystem })

function subsystemupdatesystem.new(owner)
	local self<const> = setmetatable(ecsystem.new(resolve_update_group(owner), owner.update_priority or 0), subsystemupdatesystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_update:' .. owner.id
	self.name = 'subsystem_update:' .. owner.id
	self.id = 'ecs:subsystem_update:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystemupdatesystem:update(dt_ms)
	local owner<const> = self.owner
	if owner == nil or owner.dispose_flag or not owner.active or not owner.update_enabled then
		return
	end
	owner.sc:update(dt_ms)
end

local subsystemanimationsystem<const> = {}
subsystemanimationsystem.__index = subsystemanimationsystem
setmetatable(subsystemanimationsystem, { __index = ecsystem })

function subsystemanimationsystem.new(owner)
	local priority = owner.animation_priority
	if priority == nil then
		priority = owner.update_priority or 0
	end
	local self<const> = setmetatable(ecsystem.new(tickgroup.animation, priority), subsystemanimationsystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_animation:' .. owner.id
	self.name = 'subsystem_animation:' .. owner.id
	self.id = 'ecs:subsystem_animation:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystemanimationsystem:update(dt_ms)
	local owner<const> = self.owner
	if owner == nil or owner.dispose_flag or not owner.active or not owner.update_enabled then
		return
	end
	owner.timelines:update(dt_ms)
end

local subsystempresentationsystem<const> = {}
subsystempresentationsystem.__index = subsystempresentationsystem
setmetatable(subsystempresentationsystem, { __index = ecsystem })

function subsystempresentationsystem.new(owner)
	local self<const> = setmetatable(ecsystem.new(tickgroup.presentation, owner.presentation_priority or 0), subsystempresentationsystem)
	self.owner = owner
	self.__ecs_id = 'subsystem_presentation:' .. owner.id
	self.name = 'subsystem_presentation:' .. owner.id
	self.id = 'ecs:subsystem_presentation:' .. owner.id
	self.type_name = 'ecsystem'
	return self
end

function subsystempresentationsystem:update()
	local owner<const> = self.owner
	if owner == nil or owner.dispose_flag or not owner.active or not owner.visible then
		return
	end
	owner:draw()
end

local create_presentation_system<const> = function(owner)
	if not owner.presentation_enabled then
		return nil
	end
	if owner.draw == subsystem.draw then
		return nil
	end
	return subsystempresentationsystem.new(owner)
end

return {
	subsystem = subsystem,
	create_update_system = subsystemupdatesystem.new,
	create_animation_system = subsystemanimationsystem.new,
	create_presentation_system = create_presentation_system,
}
