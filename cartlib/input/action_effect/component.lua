local compiler<const> = require('cartlib/input/action_effect/compiler')
local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')

local inputactioneffectcomponent<const> = {}
inputactioneffectcomponent.__index = inputactioneffectcomponent
setmetatable(inputactioneffectcomponent, { __index = component })

function inputactioneffectcomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.input_action_effect, true), inputactioneffectcomponent)
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

function inputactioneffectcomponent:on_activate()
	local owner<const> = self.parent
	local program<const>, uses_effect_triggers<const> = compiler.compile_program(owner, self.source_program)
	if uses_effect_triggers and not owner.actioneffects then
		error('input effects on "' .. owner.id .. '" trigger an ability component that is not attached.')
	end
	self.program = program
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

return inputactioneffectcomponent
