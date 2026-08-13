-- Admission-only lowering for stable nested-clip traversal. Each generated
-- factory captures one published active snapshot into direct child references;
-- steady playback therefore pays no array indexing or loop control per clip.
local syntax_factory<const> = lua_compiler.syntax_factory

local sequence_evaluator_syntax<const> = {}
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local return_statement<const> = syntax_factory.return_statement

function sequence_evaluator_syntax.build_active_runner_factory(count)
	local factory_body<const> = {}
	local runner_body<const> = {}
	for index = 1, count do
		local entry_name<const> = 'entry_' .. index
		factory_body[#factory_body + 1] = local_statement(
			identifier(entry_name),
			index_expression(identifier('entries'), numeric_literal(index)),
			true
		)
		runner_body[#runner_body + 1] = call_statement(call_expression(
			member_expression(identifier(entry_name), 'active_play_transform'),
			{
				identifier(entry_name),
				identifier('owner'),
				identifier('previous_time_ms'),
				identifier('time_ms'),
			}
		))
	end
	factory_body[#factory_body + 1] = return_statement({
		function_expression(
			{
				identifier('owner'),
				identifier('previous_time_ms'),
				identifier('time_ms'),
			},
			block(runner_body)
		),
	})
	return syntax_factory.chunk(block({
		return_statement({
			function_expression({ identifier('entries') }, block(factory_body)),
		}),
	}))
end

return sequence_evaluator_syntax
