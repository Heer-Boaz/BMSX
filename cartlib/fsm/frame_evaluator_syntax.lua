-- Admission-only lowering from immutable state topology to the active-frame
-- evaluator. Runtime states execute only the child lanes and local handlers
-- that their definition can actually contain.
local syntax_factory<const> = lua_compiler.syntax_factory

local frame_evaluator_syntax<const> = {}
local syntax<const> = syntax_factory.syntax
local block<const> = syntax_factory.block
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local string_literal<const> = syntax_factory.string_literal
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

local symbols<const> = {
	update_handler = generated_symbol('update_handler'),
	transition_kinds = generated_symbol('transition_kinds'),
	transitions = generated_symbol('transitions'),
	state = generated_symbol('state'),
	current = generated_symbol('current'),
	concurrent_states = generated_symbol('frame_concurrent_states'),
	bindings = generated_symbol('input_bindings'),
	next_state = generated_symbol('next_state'),
}

local emit_child<const> = function(statements, state_symbol)
	statements[#statements + 1] = if_statement({
		if_clause(
			member_expression(reference(state_symbol), 'active_frame_work'),
			block({
				call_statement(call_expression(
					reference(state_symbol),
					{},
					'frame_evaluator'
				)),
			})
		),
	})
end

local emit_active_children<const> = function(statements, values)
	if values.has_current_frame_work then
		statements[#statements + 1] = local_statement(
			reference(symbols.current),
			member_expression(reference(symbols.state), 'current_state'),
			true
		)
		emit_child(statements, symbols.current)
	end
	local concurrent_count<const> = values.frame_concurrent_state_count
	if concurrent_count == 0 then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.concurrent_states),
		member_expression(reference(symbols.state), 'frame_concurrent_states'),
		true
	)
	for index = 1, concurrent_count do
		local child_symbol<const> = generated_symbol('concurrent_state')
		statements[#statements + 1] = local_statement(
			reference(child_symbol),
			index_expression(
				reference(symbols.concurrent_states),
				numeric_literal(index)
			),
			true
		)
		emit_child(statements, child_symbol)
	end
end

local input_clause<const> = function(index)
	return if_clause(
		call_expression(
			index_expression(reference(symbols.bindings), numeric_literal(index)),
			{}
		),
		block({
			call_statement(call_expression(reference(symbols.state), {
				index_expression(
					reference(symbols.transition_kinds),
					numeric_literal(index)
				),
				index_expression(
					reference(symbols.transitions),
					numeric_literal(index)
				),
			}, 'execute_transition')),
		})
	)
end

local emit_input<const> = function(statements, values)
	local count<const> = values.input_handler_count
	if count == 0 then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.bindings),
		member_expression(reference(symbols.state), 'input_bindings'),
		true
	)
	if values.input_eval_first then
		local clauses<const> = {}
		for index = 1, count do
			clauses[index] = input_clause(index)
		end
		statements[#statements + 1] = if_statement(clauses)
		return
	end
	for index = 1, count do
		statements[#statements + 1] = if_statement({ input_clause(index) })
	end
end

local emit_update<const> = function(statements, values)
	if not values.has_update then
		return
	end
	statements[#statements + 1] = local_statement(
		reference(symbols.next_state),
		call_expression(reference(symbols.update_handler), {
			member_expression(reference(symbols.state), 'target'),
			reference(symbols.state),
		}),
		true
	)
	statements[#statements + 1] = if_statement({
		if_clause(
			binary_expression(
				syntax.binary_and,
				reference(symbols.next_state),
				binary_expression(
					syntax.binary_not_equal,
					reference(symbols.next_state),
					string_literal(values.no_op)
				)
			),
			block({
				call_statement(call_expression(
					reference(symbols.state),
					{ reference(symbols.next_state) },
					'transition_to'
				)),
			})
		),
	})
end

function frame_evaluator_syntax.build(values)
	local evaluator_body<const> = {}
	emit_active_children(evaluator_body, values)
	emit_input(evaluator_body, values)
	emit_update(evaluator_body, values)
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{
					reference(symbols.update_handler),
					reference(symbols.transition_kinds),
					reference(symbols.transitions),
				},
				block({
					return_statement({
						function_expression(
							{ reference(symbols.state) },
							block(evaluator_body)
						),
					}),
				})
			),
		}),
	}))
end

return frame_evaluator_syntax
