local frame_evaluator_syntax<const> = require('cartlib/fsm/frame_evaluator_syntax')

local frame_program<const> = {}
local compile_syntax<const> = lua_compiler.compile_syntax
local component_factories_by_machine_count<const> = {}
local factories_by_shape<const> = {}
local shape_current<const> = 0x1
local shape_update<const> = 0x2
local shape_input_first<const> = 0x4

function frame_program.compile_component_runner(machines)
	local machine_count<const> = #machines
	local factory = component_factories_by_machine_count[machine_count]
	if factory == nil then
		factory = compile_syntax(
			frame_evaluator_syntax.build_component(machine_count),
			'[fsm.component_frame]'
		)()
		component_factories_by_machine_count[machine_count] = factory
	end
	return factory(machines)
end

local get_evaluator_factory<const> = function(
	shape,
	input_handler_count,
	frame_concurrent_state_count,
	values
)
	local by_input_count = factories_by_shape[shape]
	if by_input_count == nil then
		by_input_count = {}
		factories_by_shape[shape] = by_input_count
	end
	local by_concurrent_count = by_input_count[input_handler_count]
	if by_concurrent_count == nil then
		by_concurrent_count = {}
		by_input_count[input_handler_count] = by_concurrent_count
	end
	local factory = by_concurrent_count[frame_concurrent_state_count]
	if factory == nil then
		factory = compile_syntax(
			frame_evaluator_syntax.build(values),
			'[fsm.frame_evaluator]'
		)()
		by_concurrent_count[frame_concurrent_state_count] = factory
	end
	return factory
end

function frame_program.compile_state_evaluator(definition, no_op)
	local has_current_frame_work<const> = definition.has_current_frame_work
	local has_update<const> = definition.update ~= nil
	local input_handler_count<const> = definition.input_handler_count
	local input_eval_first<const> = input_handler_count ~= 0 and definition.input_eval_first
	local frame_concurrent_state_count<const> = definition.frame_concurrent_state_count
	local shape = 0
	if has_current_frame_work then
		shape = shape | shape_current
	end
	if has_update then
		shape = shape | shape_update
	end
	if input_eval_first then
		shape = shape | shape_input_first
	end
	-- Only topology and handler count select code shape. Definitions with the
	-- same shape share machine code and bind their own immutable handlers into
	-- the returned evaluator closure.
	local factory<const> = get_evaluator_factory(
		shape,
		input_handler_count,
		frame_concurrent_state_count,
		{
			has_current_frame_work = has_current_frame_work,
			has_update = has_update,
			input_handler_count = input_handler_count,
			input_eval_first = input_eval_first,
			frame_concurrent_state_count = frame_concurrent_state_count,
			no_op = no_op,
		}
	)
	return factory(
		definition.update,
		definition.input_transition_kinds,
		definition.input_transitions
	)
end

return frame_program
