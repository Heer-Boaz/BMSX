local compiler<const> = require('cartlib/input/actioneffect/compiler')
local component<const> = require('cartlib/component/basecomponent')

local input_actioneffect_component<const> = {}
input_actioneffect_component.__index = input_actioneffect_component
input_actioneffect_component.unique = true
setmetatable(input_actioneffect_component, { __index = component })

function input_actioneffect_component.new(opts)
	local self<const> = setmetatable(component.new(opts), input_actioneffect_component)
	self.source_program = opts.program
	self.binding_latch = {}
	self.binding_touched = {}
	self.custom_matches = {}
	self.queued_commands = {}
	self.queued_command_count = 0
	self.queued_event_types = {}
	self.queued_event_payloads = {}
	self.queued_event_count = 0
	self.last_frame = 0
	return self
end

function input_actioneffect_component:on_activate()
	if self.program == nil then
		local owner<const> = self.parent
		local program<const>, uses_effect_triggers<const> = compiler.compile_program(owner, self.source_program)
		if uses_effect_triggers and not owner.actioneffects then
			error('input effects on "' .. owner.id .. '" trigger an action-effect component that is not attached.')
		end
		self.program = program
	end
	local program<const> = self.program
	for i = 1, #program.bindings do
		self.binding_latch[i] = false
		self.binding_touched[i] = 0
	end
	for i = 1, program.max_custom_count do
		self.custom_matches[i] = false
	end
	for i = 1, program.queued_command_capacity do
		self.queued_commands[i] = false
	end
	for i = 1, program.queued_event_capacity do
		self.queued_event_types[i] = false
		self.queued_event_payloads[i] = false
	end
	self.queued_command_count = 0
	self.queued_event_count = 0
	self.last_frame = 0
end

function input_actioneffect_component:on_detach()
	self.program = nil
end

return input_actioneffect_component
