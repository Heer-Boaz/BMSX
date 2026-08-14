-- Admission-only lowering from a cooked timeline shape to its method-specific
-- evaluator. Playback does not branch over absent track families.
local syntax_factory<const> = lua_compiler.syntax_factory
local event_evaluator_syntax<const> = require('cartlib/timeline/event_evaluator_syntax')
local value_runner_signature<const> = require('cartlib/timeline/value_runner_signature')

local evaluation_program_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local binary_expression<const> = syntax_factory.binary_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

-- The factory, its captures and the three method evaluators share lexical
-- bindings by symbol identity. Environment lookups keep their authored names;
-- generated references never reconstruct those names.
local symbols<const> = {
	program = generated_symbol('program'),
	entry = generated_symbol('entry'),
	owner = generated_symbol('owner'),
	previous_frame = generated_symbol('previous_frame'),
	frame = generated_symbol('frame'),
	previous_time_ms = generated_symbol('previous_time_ms'),
	time_ms = generated_symbol('time_ms'),
	direction = generated_symbol('direction'),
	flags = generated_symbol('flags'),
	sample = generated_symbol('sample'),
	evaluation = generated_symbol('evaluation'),
	bind_play_tags = generated_symbol('bind_play_tags'),
	bind_position_tags = generated_symbol('bind_position_tags'),
	bind_play_sequences = generated_symbol('bind_play_sequences'),
	bind_position_sequences = generated_symbol('bind_position_sequences'),
	write_evaluation_context = generated_symbol('write_evaluation_context'),
	frame_value = generated_symbol('frame_value'),
	play_value_runner = generated_symbol('play_value_runner'),
	position_value_runner = generated_symbol('position_value_runner'),
	apply_function = generated_symbol('apply_function'),
	frame_appliers = generated_symbol('frame_appliers'),
	evaluate_play_tags = generated_symbol('evaluate_play_tags'),
	evaluate_position_tags = generated_symbol('evaluate_position_tags'),
	evaluate_play_sequences = generated_symbol('evaluate_play_sequences'),
	evaluate_jump_sequences = generated_symbol('evaluate_jump_sequences'),
	evaluate_scrub_sequences = generated_symbol('evaluate_scrub_sequences'),
	evaluate_play = generated_symbol('evaluate_play'),
	evaluate_jump = generated_symbol('evaluate_jump'),
	evaluate_scrub = generated_symbol('evaluate_scrub'),
}

local operand<const> = value_runner_signature.operand
local symbol_by_operand<const> = {
	[operand.entry] = symbols.entry,
	[operand.previous_frame] = symbols.previous_frame,
	[operand.frame] = symbols.frame,
	[operand.previous_time_ms] = symbols.previous_time_ms,
	[operand.time_ms] = symbols.time_ms,
	[operand.direction] = symbols.direction,
	[operand.flags] = symbols.flags,
	[operand.sample] = symbols.sample,
	[operand.evaluation] = symbols.evaluation,
}

local evaluator_parameters<const> = function()
	return {
		reference(symbols.entry),
		reference(symbols.owner),
		reference(symbols.previous_frame),
		reference(symbols.frame),
		reference(symbols.previous_time_ms),
		reference(symbols.time_ms),
		reference(symbols.direction),
		reference(symbols.flags),
	}
end

local build_dependency_captures<const> = function(values)
	local statements<const> = {}
	if values.has_tags then
		statements[#statements + 1] = local_statement(
			reference(symbols.bind_play_tags),
			identifier('bind_play_tags'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.bind_position_tags),
			identifier('bind_position_tags'),
			true
		)
	end
	if values.has_subsequences then
		statements[#statements + 1] = local_statement(
			reference(symbols.bind_play_sequences),
			identifier('bind_play_sequences'),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.bind_position_sequences),
			identifier('bind_position_sequences'),
			true
		)
	end
	event_evaluator_syntax.capture_dependencies(statements, values)
	if values.has_evaluation_context then
		statements[#statements + 1] = local_statement(
			reference(symbols.write_evaluation_context),
			identifier('write_evaluation_context'),
			true
		)
	elseif values.has_frame_appliers then
		statements[#statements + 1] = local_statement(
			reference(symbols.frame_value),
			identifier('frame_value'),
			true
		)
	end
	return statements
end

local build_program_captures<const> = function(values)
	local statements<const> = {}
	event_evaluator_syntax.capture_program(statements, values, symbols)
	if values.has_values then
		statements[#statements + 1] = local_statement(
			reference(symbols.play_value_runner),
			member_expression(
				member_expression(reference(symbols.program), 'tracks'),
				'play_value_runner'
			),
			true
		)
		if values.has_position_values then
			statements[#statements + 1] = local_statement(
				reference(symbols.position_value_runner),
				member_expression(
					member_expression(reference(symbols.program), 'tracks'),
					'position_value_runner'
				),
				true
			)
		end
	end
	if values.has_apply_function then
		statements[#statements + 1] = local_statement(
			reference(symbols.apply_function),
			member_expression(reference(symbols.program), 'apply_function'),
			true
		)
	end
	if values.has_frame_appliers then
		statements[#statements + 1] = local_statement(
			reference(symbols.frame_appliers),
			member_expression(reference(symbols.program), 'frame_appliers'),
			true
		)
	end
	if values.has_tags then
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate_play_tags),
			call_expression(reference(symbols.bind_play_tags), { reference(symbols.program) }),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate_position_tags),
			call_expression(reference(symbols.bind_position_tags), { reference(symbols.program) }),
			true
		)
	end
	if values.has_subsequences then
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate_play_sequences),
			call_expression(reference(symbols.bind_play_sequences), { reference(symbols.program) }),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate_jump_sequences),
			call_expression(reference(symbols.bind_position_sequences), {
				reference(symbols.program),
				numeric_literal(values.jump_method),
			}),
			true
		)
		statements[#statements + 1] = local_statement(
			reference(symbols.evaluate_scrub_sequences),
			call_expression(reference(symbols.bind_position_sequences), {
				reference(symbols.program),
				numeric_literal(values.scrub_method),
			}),
			true
		)
	end
	return statements
end

local emit_evaluation_context<const> = function(statements, values, update_method)
	statements[#statements + 1] = local_statement(
		reference(symbols.sample),
		binary_expression(
			syntax.binary_not_equal,
			binary_expression(
				syntax.binary_bitwise_and,
				reference(symbols.flags),
				numeric_literal(values.sample_flag)
			),
			numeric_literal(0)
		),
		true
	)
	statements[#statements + 1] = local_statement(
		reference(symbols.evaluation),
		call_expression(reference(symbols.write_evaluation_context), {
			member_expression(reference(symbols.entry), 'evaluation_context'),
			reference(symbols.program),
			numeric_literal(update_method),
			reference(symbols.previous_frame),
			reference(symbols.frame),
			reference(symbols.previous_time_ms),
			reference(symbols.time_ms),
			reference(symbols.direction),
			reference(symbols.sample),
			reference(symbols.flags),
		}),
		true
	)
end

local emit_tags<const> = function(statements, evaluator_name)
	if evaluator_name == 'play' then
		statements[#statements + 1] = call_statement(call_expression(
			reference(symbols.evaluate_play_tags),
			{
				reference(symbols.entry),
				reference(symbols.owner),
				reference(symbols.previous_frame),
				reference(symbols.frame),
				reference(symbols.previous_time_ms),
				reference(symbols.time_ms),
				reference(symbols.direction),
				reference(symbols.flags),
			}
		))
	else
		statements[#statements + 1] = call_statement(call_expression(
			reference(symbols.evaluate_position_tags),
			{
				reference(symbols.entry),
				reference(symbols.owner),
				reference(symbols.frame),
				reference(symbols.time_ms),
			}
		))
	end
end

local value_runner_arguments<const> = function(values, position)
	local operands = values.play_value_operands
	if position then
		operands = values.position_value_operands
	end
	local arguments<const> = {}
	for index = 1, #operands do
		arguments[index] = reference(symbol_by_operand[operands[index]])
	end
	return arguments
end

local emit_values<const> = function(statements, values, evaluator_name)
	local position<const> = evaluator_name ~= 'play' and values.has_position_values
	local runner_symbol<const> = position
		and symbols.position_value_runner
		or symbols.play_value_runner
	statements[#statements + 1] = call_statement(call_expression(
		reference(runner_symbol),
		value_runner_arguments(values, position)
	))
end

local emit_sample<const> = function(statements, values)
	local sample_statements<const> = {}
	if values.has_apply_function then
		sample_statements[#sample_statements + 1] = call_statement(call_expression(
			reference(symbols.apply_function),
			{
				member_expression(reference(symbols.entry), 'primary_binding'),
				member_expression(reference(symbols.evaluation), 'value'),
				member_expression(reference(symbols.entry), 'params'),
				reference(symbols.evaluation),
			}
		))
	end
	if values.has_frame_appliers then
		local frame_value
		if values.has_evaluation_context then
			frame_value = member_expression(reference(symbols.evaluation), 'value')
		else
			frame_value = call_expression(reference(symbols.frame_value), {
				reference(symbols.program),
				reference(symbols.frame),
			})
		end
		sample_statements[#sample_statements + 1] = call_statement(call_expression(
			index_expression(
				reference(symbols.frame_appliers),
				binary_expression(
					syntax.binary_add,
					reference(symbols.frame),
					numeric_literal(1)
				)
			),
			{
				member_expression(reference(symbols.entry), 'primary_binding'),
				frame_value,
			}
		))
	end
	local sample_condition
	if values.has_evaluation_context then
		sample_condition = reference(symbols.sample)
	else
		sample_condition = binary_expression(
			syntax.binary_not_equal,
			binary_expression(
				syntax.binary_bitwise_and,
				reference(symbols.flags),
				numeric_literal(values.sample_flag)
			),
			numeric_literal(0)
		)
	end
	statements[#statements + 1] = if_statement({
		if_clause(sample_condition, block(sample_statements)),
	})
end

local emit_sequences<const> = function(statements, values, evaluator_name, update_method)
	if evaluator_name == 'play' then
		statements[#statements + 1] = call_statement(call_expression(
			reference(symbols.evaluate_play_sequences),
			{
				reference(symbols.entry),
				reference(symbols.owner),
				reference(symbols.previous_time_ms),
				reference(symbols.time_ms),
				reference(symbols.direction),
				reference(symbols.flags),
			}
		))
		return
	end
	local evaluator_symbol<const> = update_method == values.jump_method
		and symbols.evaluate_jump_sequences
		or symbols.evaluate_scrub_sequences
	statements[#statements + 1] = call_statement(call_expression(reference(evaluator_symbol), {
		reference(symbols.entry),
		reference(symbols.owner),
		reference(symbols.previous_time_ms),
		reference(symbols.time_ms),
	}))
end

local build_evaluator_body<const> = function(values, evaluator_name, update_method)
	local statements<const> = {}
	if values.has_evaluation_context then
		emit_evaluation_context(statements, values, update_method)
	end
	if values.has_tags then
		emit_tags(statements, evaluator_name)
	end
	if values.has_values then
		emit_values(statements, values, evaluator_name)
	end
	if values.has_apply_function or values.has_frame_appliers then
		emit_sample(statements, values)
	end
	if values.has_subsequences then
		emit_sequences(statements, values, evaluator_name, update_method)
	end
	event_evaluator_syntax.emit(statements, values, symbols, evaluator_name, update_method)
	return statements
end

local build_evaluator_declaration<const> = function(symbol, body)
	return local_statement(
		reference(symbol),
		function_expression(evaluator_parameters(), block(body)),
		true
	)
end

function evaluation_program_syntax.build(values)
	local statements<const> = build_dependency_captures(values)
	local factory_body<const> = build_program_captures(values)
	factory_body[#factory_body + 1] = build_evaluator_declaration(
		symbols.evaluate_play,
		build_evaluator_body(values, 'play', values.play_method)
	)
	if not values.has_evaluation_context and values.jump_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_statement(
			reference(symbols.evaluate_jump),
			reference(symbols.evaluate_play),
			true
		)
	else
		factory_body[#factory_body + 1] = build_evaluator_declaration(
			symbols.evaluate_jump,
			build_evaluator_body(values, values.jump_evaluator, values.jump_method)
		)
	end
	if not values.has_evaluation_context and values.scrub_evaluator == 'play' then
		factory_body[#factory_body + 1] = local_statement(
			reference(symbols.evaluate_scrub),
			reference(symbols.evaluate_play),
			true
		)
	elseif not values.has_evaluation_context and values.scrub_evaluator == values.jump_evaluator then
		factory_body[#factory_body + 1] = local_statement(
			reference(symbols.evaluate_scrub),
			reference(symbols.evaluate_jump),
			true
		)
	else
		factory_body[#factory_body + 1] = build_evaluator_declaration(
			symbols.evaluate_scrub,
			build_evaluator_body(values, values.scrub_evaluator, values.scrub_method)
		)
	end
	factory_body[#factory_body + 1] = return_statement({
		reference(symbols.evaluate_play),
		reference(symbols.evaluate_jump),
		reference(symbols.evaluate_scrub),
	})
	statements[#statements + 1] = return_statement({
		function_expression({ reference(symbols.program) }, block(factory_body)),
	})
	return syntax_factory.chunk(block(statements))
end

return evaluation_program_syntax
