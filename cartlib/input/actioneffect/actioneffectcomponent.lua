local compiler<const> = require('cartlib/input/actioneffect/compiler')
local basecomponent<const> = require('cartlib/component/basecomponent')

local inputactioneffectcomponent<const> = {}
inputactioneffectcomponent.__index = inputactioneffectcomponent
inputactioneffectcomponent.unique = true
setmetatable(inputactioneffectcomponent, { __index = basecomponent })

function inputactioneffectcomponent.new(opts)
	local self<const> = setmetatable(basecomponent.new(opts), inputactioneffectcomponent)
	self.source_program = opts.program
	return self
end

function inputactioneffectcomponent:on_activate()
	if self.program == nil then
		local owner<const> = self.parent
		local program<const>, uses_effect_triggers<const> = compiler.compile_program(owner, self.source_program)
		if uses_effect_triggers and not owner.actioneffects then
			error('input effects on "' .. owner.id .. '" trigger an action-effect component that is not attached.')
		end
		self.program = program
		if program.release_binding_count > 0 then
			self.binding_latch = {}
		end
		if program.max_custom_count > 0 then
			self.custom_matches = {}
		end
		if program.queued_command_capacity > 0 then
			self.queued_commands = {}
		end
		if program.queued_event_capacity > 0 then
			self.queued_event_types = {}
			self.queued_event_payloads = {}
		end
	end
	local program<const> = self.program
	if program.release_binding_count > 0 then
		local binding_latch<const> = self.binding_latch
		for i = 1, #program.bindings do
			binding_latch[i] = false
		end
		self.last_frame = 0
	end
	if program.max_custom_count > 0 then
		local custom_matches<const> = self.custom_matches
		for i = 1, program.max_custom_count do
			custom_matches[i] = false
		end
	end
	if program.queued_command_capacity > 0 then
		local queued_commands<const> = self.queued_commands
		for i = 1, program.queued_command_capacity do
			queued_commands[i] = false
		end
		self.queued_command_count = 0
	end
	if program.queued_event_capacity > 0 then
		local queued_event_types<const> = self.queued_event_types
		local queued_event_payloads<const> = self.queued_event_payloads
		for i = 1, program.queued_event_capacity do
			queued_event_types[i] = false
			queued_event_payloads[i] = false
		end
		self.queued_event_count = 0
	end
end

function inputactioneffectcomponent:on_detach()
	self.program = nil
	self.binding_latch = nil
	self.custom_matches = nil
	self.queued_commands = nil
	self.queued_event_types = nil
	self.queued_event_payloads = nil
end

return inputactioneffectcomponent
