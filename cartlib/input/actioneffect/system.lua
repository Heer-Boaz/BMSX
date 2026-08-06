local inputactioneffectcomponent<const> = require('cartlib/input/actioneffect/actioneffectcomponent')
local input<const> = require('cartlib/input/input')
local system<const> = require('cartlib/world/basesystem')
local tick_group<const> = require('cartlib/world/tick_group')


local modes_allow<const> = function(owner, modes)
	if modes == nil then
		return true
	end
	for i = 1, #modes do
		local mode<const> = modes[i]
		local matches = true
		if mode.path ~= nil then
			matches = owner.state_machines:matches_state(mode.path)
		end
		if mode.tag ~= nil then
			matches = matches and owner:has_tag(mode.tag)
		end
		if mode.negated == matches then
			return false
		end
	end
	return true
end

local reset_latches<const> = function(component)
	local latch<const> = component.binding_latch
	local touched<const> = component.binding_touched
	for i = 1, #component.program.bindings do
		latch[i] = false
		touched[i] = 0
	end
end

local evaluate_component<const> = function(component, frame)
	if component.last_frame ~= frame - 1 then
		reset_latches(component)
	end
	component.last_frame = frame
	local program<const> = component.program
	local bindings<const> = program.bindings
	local latch<const> = component.binding_latch
	local touched<const> = component.binding_touched
	local custom_matches<const> = component.custom_matches
	local owner<const> = component.parent
	for i = 1, #bindings do
		local binding<const> = bindings[i]
		if not modes_allow(owner, binding.modes) then
			goto continue
		end
		local armed<const> = latch[i]
		if armed then
			touched[i] = frame
		end
		local press<const> = binding.press and input.is_active(binding.press)
		local hold<const> = binding.hold and input.is_active(binding.hold)
		local release<const> = binding.release and input.is_active(binding.release)
		local custom<const> = binding.custom
		if not armed and not press and not hold and not release and #custom == 0 then
			goto continue
		end
		for j = 1, #custom do
			custom_matches[j] = input.is_active(custom[j].input)
		end
		local matched
		if press then
			matched = true
			local effect<const> = binding.press_effect
			if effect then
				effect(component)
			end
			latch[i] = true
			touched[i] = frame
		end
		if hold then
			matched = true
			local effect<const> = binding.hold_effect
			if effect then
				effect(component)
			end
			latch[i] = true
			touched[i] = frame
		end
		if release and armed then
			matched = true
			local effect<const> = binding.release_effect
			if effect then
				effect(component)
			end
			latch[i] = false
			touched[i] = 0
		end
		for j = 1, #custom do
			if custom_matches[j] then
				matched = true
				local effect<const> = custom[j].effect
				if effect then
					effect(component)
				end
			end
		end
		if matched and program.stop_after_match then
			break
		end
		::continue::
	end
	for i = 1, #bindings do
		if latch[i] and touched[i] ~= frame then
			latch[i] = false
		end
	end
	local commands<const> = component.queued_commands
	for i = 1, component.queued_command_count do
		local command<const> = commands[i]
		owner.state_machines:dispatch(command.event, command.payload)
		commands[i] = false
	end
	component.queued_command_count = 0
	local event_types<const> = component.queued_event_types
	local event_payloads<const> = component.queued_event_payloads
	for i = 1, component.queued_event_count do
		owner.events:emit(event_types[i], event_payloads[i])
		event_types[i] = false
		event_payloads[i] = false
	end
	component.queued_event_count = 0
end

local inputactioneffectsystem<const> = {}
inputactioneffectsystem.__index = inputactioneffectsystem
setmetatable(inputactioneffectsystem, { __index = system })

function inputactioneffectsystem.new(world)
	local self<const> = setmetatable(system.new(tick_group.input, 10), inputactioneffectsystem)
	self._component_view = world:_active_component_view(inputactioneffectcomponent)
	self.frame = 0
	return self
end

function inputactioneffectsystem:update()
	local frame<const> = self.frame + 1
	self.frame = frame
	local components<const> = self._component_view.items
	for i = 1, #components do
		evaluate_component(components[i], frame)
	end
end

return inputactioneffectsystem
