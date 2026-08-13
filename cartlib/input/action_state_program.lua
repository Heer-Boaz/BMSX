local action_state_program_syntax<const> = require('cartlib/input/action_state_program_syntax')

local action_state_program<const> = {}
local compile_syntax<const> = lua_compiler.compile_syntax
local runner_by_requirement_mask<const> = {}

function action_state_program.compile(requirement_mask, environment)
	local runner<const> = runner_by_requirement_mask[requirement_mask]
	if runner ~= nil then
		return runner
	end
	local compiled<const> = compile_syntax(
		action_state_program_syntax.build(requirement_mask),
		'[input.action_state]',
		environment
	)()
	runner_by_requirement_mask[requirement_mask] = compiled
	return compiled
end

return action_state_program
