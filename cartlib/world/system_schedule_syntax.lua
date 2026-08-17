-- Admission-only lowering of the fixed world-system composition. The returned
-- runner retains each concrete system directly and commits one structural
-- barrier after every configured tick group.
local syntax_factory<const> = lua_compiler.syntax_factory

local system_schedule_syntax<const> = {}
local block<const> = syntax_factory.block
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local index_expression<const> = syntax_factory.index_expression
local call_expression<const> = syntax_factory.call_expression
local function_expression<const> = syntax_factory.function_expression
local local_statement<const> = syntax_factory.local_statement
local call_statement<const> = syntax_factory.call_statement
local if_clause<const> = syntax_factory.if_clause
local if_statement<const> = syntax_factory.if_statement
local return_statement<const> = syntax_factory.return_statement

local symbols<const> = {
	world = generated_symbol('world'),
	systems = generated_symbol('systems'),
}

local append_group<const> = function(body, system_symbols, tick_functions, first, last, delta_time)
	body[#body + 1] = call_statement(call_expression(
		reference(symbols.world),
		{},
		'_open_mutation_barrier'
	))
	for tick_index = first, last do
		local tick_function<const> = tick_functions[tick_index]
		local definition<const> = tick_function.definition
		body[#body + 1] = call_statement(call_expression(
			reference(system_symbols[tick_function.system_index]),
			{ numeric_literal(delta_time) },
			definition.method
		))
	end
	body[#body + 1] = if_statement({
		if_clause(
			call_expression(
				reference(symbols.world),
				{},
				'_commit_mutation_barrier'
			),
			block({ return_statement({}) })
		),
	})
end

local build_runner<const> = function(system_symbols, tick_functions, delta_time)
	local body<const> = {}
	local first = 1
	while first <= #tick_functions do
		local group<const> = tick_functions[first].definition.group
		local last = first
		while last < #tick_functions and tick_functions[last + 1].definition.group == group do
			last = last + 1
		end
		append_group(body, system_symbols, tick_functions, first, last, delta_time)
		first = last + 1
	end
	return function_expression({}, block(body))
end

function system_schedule_syntax.build(
	systems,
	update_with_gameplay,
	update_without_gameplay,
	delta_time
)
	local system_count<const> = #systems
	local system_symbols<const> = {}
	local factory_body<const> = {}
	for system_index = 1, system_count do
		local system_symbol<const> = generated_symbol('system')
		system_symbols[system_index] = system_symbol
		factory_body[system_index] = local_statement(
			reference(system_symbol),
			index_expression(reference(symbols.systems), numeric_literal(system_index)),
			true
		)
	end

	factory_body[#factory_body + 1] = return_statement({
		build_runner(system_symbols, update_with_gameplay, delta_time),
		build_runner(system_symbols, update_without_gameplay, delta_time),
	})
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ reference(symbols.world), reference(symbols.systems) },
				block(factory_body)
			),
		}),
	}))
end

return system_schedule_syntax
