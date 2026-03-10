-- input_action_effect_dsl.lua
-- input action effect program schema helpers

local function is_input_action_effect_program(value)
	return type(value) == 'table' and type(value.bindings) == 'table'
end

local function is_dispatch_command_effect(value)
	return type(value) == 'table' and value['dispatch.command'] ~= nil
end

return {
	is_input_action_effect_program = is_input_action_effect_program,
	is_dispatch_command_effect = is_dispatch_command_effect,
}
