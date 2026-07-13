local eventemitter<const> = require('cartlib/eventemitter')
local fsm<const> = require('cartlib/fsm/index')
local fsmlibrary<const> = require('cartlib/fsm/library')
local ecs<const> = require('cartlib/ecs/index')
local subsystem_timeline_module<const> = require('cartlib/subsystem/timelines')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local subsystemtimelines<const> = subsystem_timeline_module.subsystemtimelines

local subsystem<const> = {}
subsystem.__index = subsystem

function subsystem.new(opts)
	opts = opts or {}
	local self<const> = setmetatable({}, subsystem)
	self.type_name = opts.type_name or 'subsystem'
	self.id = opts.id or world_instance:next_id(self.type_name)
	self.active = false
	self.fsm_dispatch_enabled = false
	self.player_index = opts.player_index
	self.tags = opts.tags or {}
	self.dispose_flag = false
	self.is_subsystem = true
	self.events = eventemitter.events_of(self)
	local definition<const> = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	self.timelines = subsystemtimelines.new(self)
	self.update_group = opts.update_group or tickgroup.moderesolution
	self.update_priority = opts.update_priority
	self.animation_priority = opts.animation_priority
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
	self.fsm_dispatch_enabled = true
	self:bind()
	self.sc:start()
end

function subsystem:deactivate()
	self.active = false
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
	if self.dispose_flag then
		return
	end
	self.dispose_flag = true
	self:deactivate()
	world_instance._subsystems_by_id[self.id] = nil
	world_instance:queue_subsystem_disposal(self)
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

local subsystem_systems<const> = require('cartlib/subsystem/systems')

return {
	subsystem = subsystem,
	create_update_system = subsystem_systems.create_update_system,
	create_animation_system = subsystem_systems.create_animation_system,
}
