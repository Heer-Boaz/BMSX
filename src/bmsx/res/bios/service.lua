-- service.lua
-- lightweight service base with fsm hook

local eventemitter = require("eventemitter")
local fsm = require("fsm")
local fsmlibrary = require("fsmlibrary")

local registry = require("registry")

local service = {}
service.__index = service

function service.new(opts)
	local self = setmetatable({}, service)
	opts = opts or {}
	self.id = opts.id or "service"
	self.type_name = "service"
	self.registrypersistent = opts.registrypersistent ~= false
	self.active = false
	self.tick_enabled = true
	self.eventhandling_enabled = false
	self.events = eventemitter.events_of(self)
	local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	return self
end

function service:enable_events()
	self.eventhandling_enabled = true
end

function service:disable_events()
	self.eventhandling_enabled = false
end

function service:activate()
	self.active = true
	self:enable_events()
	self.sc:start()
	self.sc:resume()
end

function service:deactivate()
	self.active = false
	self:disable_events()
	self.sc:pause()
end

-- Forwards an event to the FSM, which can be used for state transitions or as a general-purpose event bus for the service's internal logic. The event can be a string (event type) or a table (event object). If it's a string, it will be wrapped in a table with the type and emitter fields.
function service:dispatch_state_event(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

-- Useless alias for dispatch_state_event, but provided for semantic clarity in some cases, so that Codex can recognize the intent as dispatching a command rather than a gameplay fact.
function service:dispatch_command(event_or_name, payload)
	return self.sc:dispatch(event_or_name, payload)
end

function service:dispose()
	self:disable_events()
	eventemitter.eventemitter.instance:remove_subscriber(self)
	self.sc:dispose()
	registry.instance:deregister(self, true)
end

return service
