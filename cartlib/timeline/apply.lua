local timeline_apply<const> = {}
local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local emit_frame_path<const> = function(printer, values)
	printer:print_raw('frame')
	printer:print_path(values.path)
end

local emit_target_path<const> = function(printer, values)
	printer:print_raw('target')
	printer:print_path(values.path)
end

local emit_primary_binding_path<const> = function(printer, values)
	printer:print_raw('entry["primary_binding"]')
	printer:print_path(values.path)
end

local emit_indexed_binding_path<const> = function(printer, values)
	printer:print_raw('entry["bindings"]')
	printer:print_index(values.binding_index)
	printer:print_path(values.path)
end

local templates<const> = {}

templates.frame_assignment = lua_source_printer.compile_template(
	'$target_path$ = $frame_path$\n',
	{
		target_path = emit_target_path,
		frame_path = emit_frame_path,
	}
)

local emit_frame_assignments
emit_frame_assignments = function(printer, node, values)
	local path<const> = values.path
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			emit_frame_assignments(printer, value, values)
		else
			printer:emit(templates.frame_assignment, values)
		end
		path[path_index] = nil
	end
end

local emit_frame_function_body<const> = function(printer, values)
	emit_frame_assignments(printer, values.frame, values)
end

templates.frame_function = lua_source_printer.compile_template([[
	return function(target, frame)
		$assignments$
	end
]], { assignments = emit_frame_function_body })

templates.primary_step_function = lua_source_printer.compile_template([[
	return function(entry, value)
		$binding_path$ = value
	end
]], { binding_path = emit_primary_binding_path })

templates.indexed_step_function = lua_source_printer.compile_template([[
	return function(entry, value)
		$binding_path$ = value
	end
]], { binding_path = emit_indexed_binding_path })

local compile_frame_apply<const> = function(frame, shape_cache)
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.frame_function, { frame = frame, path = {} })
	local source<const> = printer:finish()
	local apply_frame = shape_cache[source]
	if apply_frame == nil then
		apply_frame = load(source, '[timeline.apply.frame]', 't')()
		shape_cache[source] = apply_frame
	end
	return apply_frame
end

function timeline_apply.compile_frames(frames)
	local frame_appliers<const> = {}
	local applier_by_frame<const> = {}
	local shape_cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		local apply_frame = applier_by_frame[frame]
		if apply_frame == nil then
			apply_frame = compile_frame_apply(frame, shape_cache)
			applier_by_frame[frame] = apply_frame
		end
		frame_appliers[i] = apply_frame
	end
	return frame_appliers
end

-- Step bindings are fixed by the compiled sequence program. Resolve that
-- binding once here instead of branching for every crossed key at runtime.
function timeline_apply.compile_step_apply(path, apply, binding_index)
	if apply ~= nil then
		if binding_index == 1 then
			return function(entry, value, params, evaluation)
				apply(entry.primary_binding, value, params, evaluation)
			end
		end
		return function(entry, value, params, evaluation)
			apply(entry.bindings[binding_index], value, params, evaluation)
		end
	end

	local template = templates.primary_step_function
	if binding_index ~= 1 then
		template = templates.indexed_step_function
	end
	local printer<const> = lua_source_printer.new()
	printer:emit(template, { path = path, binding_index = binding_index })
	return load(printer:finish(), '[timeline.apply.step]', 't')()
end

return timeline_apply
