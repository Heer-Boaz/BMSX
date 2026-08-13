local syntax_factory<const> = lua_compiler.syntax_factory

local apply_source<const> = {}
local block<const> = syntax_factory.block
local identifier<const> = syntax_factory.identifier
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local index_path<const> = syntax_factory.index_path
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local return_statement<const> = syntax_factory.return_statement

local collect_frame_assignments
collect_frame_assignments = function(statements, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			collect_frame_assignments(statements, value, path)
		else
			statements[#statements + 1] = assignment_statement(
				index_path(identifier('target'), path),
				index_path(identifier('frame'), path)
			)
		end
		path[path_index] = nil
	end
end

function apply_source.build_frame(frame)
	local body<const> = {}
	collect_frame_assignments(body, frame, {})
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ identifier('target'), identifier('frame') },
				block(body)
			),
		}),
	}))
end

function apply_source.build_step(path, binding_index)
	local binding = member_expression(identifier('entry'), 'primary_binding')
	if binding_index ~= 1 then
		binding = index_expression(
			member_expression(identifier('entry'), 'bindings'),
			numeric_literal(binding_index)
		)
	end
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ identifier('entry'), identifier('value') },
				block({
				assignment_statement(
					index_path(binding, path),
					identifier('value')
				),
				})
			),
		}),
	}))
end

return apply_source
