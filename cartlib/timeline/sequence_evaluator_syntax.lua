-- Admission-only lowering for stable nested-clip traversal. Each generated
-- factory captures one published active snapshot into direct child references;
-- steady playback therefore pays no array indexing or loop control per clip.
local syntax_factory<const> = lua_compiler.syntax_factory

local sequence_evaluator_syntax<const> = {}
local block<const> = syntax_factory.block
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local return_statement<const> = syntax_factory.return_statement

local symbols<const> = {
	entries = generated_symbol('entries'),
	owner = generated_symbol('owner'),
	previous_time_ms = generated_symbol('previous_time_ms'),
	time_ms = generated_symbol('time_ms'),
}

function sequence_evaluator_syntax.build_active_runner_factory(count)
	local factory_body<const> = {}
	local runner_body<const> = {}
	for index = 1, count do
		local entry_symbol<const> = generated_symbol('entry')
		factory_body[#factory_body + 1] = local_statement(
			reference(entry_symbol),
			index_expression(reference(symbols.entries), numeric_literal(index)),
			true
		)
		runner_body[#runner_body + 1] = call_statement(call_expression(
			member_expression(reference(entry_symbol), 'active_play_transform'),
			{
				reference(entry_symbol),
				reference(symbols.owner),
				reference(symbols.previous_time_ms),
				reference(symbols.time_ms),
			}
		))
	end
	factory_body[#factory_body + 1] = return_statement({
		function_expression(
			{
				reference(symbols.owner),
				reference(symbols.previous_time_ms),
				reference(symbols.time_ms),
			},
			block(runner_body)
		),
	})
	return syntax_factory.chunk(block({
		return_statement({
			function_expression({ reference(symbols.entries) }, block(factory_body)),
		}),
	}))
end

return sequence_evaluator_syntax
