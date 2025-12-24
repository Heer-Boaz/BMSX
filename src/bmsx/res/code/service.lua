-- service.lua
-- Lightweight service base with FSM hook

local eventemitter = require("eventemitter")
local fsm = require("fsm")
local fsmlibrary = require("fsmlibrary")

local registry = require("registry")

local Service = {}
Service.__index = Service

function Service.new(opts)
	local self = setmetatable({}, Service)
	opts = opts or {}
	self.id = opts.id or "service"
	self.type_name = "Service"
	self.registrypersistent = opts.registrypersistent ~= false
	self.active = false
	self.tick_enabled = true
	self.eventhandling_enabled = false
	self.events = eventemitter.events_of(self)
	local definition = opts.definition or (opts.fsm_id and fsmlibrary.get(opts.fsm_id))
	self.sc = opts.sc or fsm.StateMachineController.new({ target = self, definition = definition, fsm_id = opts.fsm_id })
	return self
end

function Service:enable_events()
	self.eventhandling_enabled = true
end

function Service:disable_events()
	self.eventhandling_enabled = false
end

function Service:activate()
	self.active = true
	self:enable_events()
	self.sc:start()
	self.sc:resume()
end

function Service:deactivate()
	self.active = false
	self:disable_events()
	self.sc:pause()
end

function Service:dispose()
	self:disable_events()
	eventemitter.EventEmitter.instance:remove_subscriber(self)
	self.sc:dispose()
	registry.instance:deregister(self, true)
end

return Service
