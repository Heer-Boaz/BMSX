local compiler<const> = require('cartlib/input/actioneffect/compiler')
local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local input_actioneffect_component<const> = {}
input_actioneffect_component.__index = input_actioneffect_component
input_actioneffect_component.unique = true
setmetatable(input_actioneffect_component, { __index = base_component })

function input_actioneffect_component.new(owner, configuration)
	local self<const>, definition<const> = base_component.new(owner, configuration)
	setmetatable(self, input_actioneffect_component)
	local id_local<const> = definition.id_local or 'input'
	self.id_local = id_local
	self.source_program = definition.program
	self.clock_source = definition.clock_source or clock.gameplay
	self:set_tick_clock_enabled(self.clock_source, true)
	return self
end

function input_actioneffect_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	return function(owner)
		return input_actioneffect_component.new(owner, defaults)
	end
end

function input_actioneffect_component:on_activate()
	if self.program == nil then
		local owner<const> = self.owner
		local program<const>, uses_effect_triggers<const> = compiler.compile_program(
			owner,
			self.source_program,
			self.clock_source
		)
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
	local combo_resets<const> = program.combo_resets
	for i = 1, #combo_resets do
		combo_resets[i]()
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

function input_actioneffect_component:on_detach()
	self.program = nil
	self.binding_latch = nil
	self.custom_matches = nil
	self.queued_commands = nil
	self.queued_event_types = nil
	self.queued_event_payloads = nil
end

return input_actioneffect_component
