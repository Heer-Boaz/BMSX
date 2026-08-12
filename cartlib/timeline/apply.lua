local timeline_apply<const> = {}
local format<const> = string.format

local append_path<const> = function(parts, root, path)
	parts[#parts + 1] = root
	for index = 1, #path do
		local key<const> = path[index]
		parts[#parts + 1] = '['
		parts[#parts + 1] = type(key) == 'number' and key or format('%q', key)
		parts[#parts + 1] = ']'
	end
end

local append_frame_assignments
append_frame_assignments = function(parts, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			append_frame_assignments(parts, value, path)
		else
			append_path(parts, 'target', path)
			parts[#parts + 1] = ' = '
			append_path(parts, 'frame', path)
			parts[#parts + 1] = '\n'
		end
		path[path_index] = nil
	end
end

local compile_frame_apply<const> = function(frame, shape_cache)
	local parts<const> = { 'return function(target, frame)\n' }
	append_frame_assignments(parts, frame, {})
	parts[#parts + 1] = 'end'
	local source<const> = table.concat(parts)
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

function timeline_apply.compile_setter(path)
	local parts<const> = { 'return function(target, value)\n' }
	append_path(parts, 'target', path)
	parts[#parts + 1] = ' = value\nend'
	return load(table.concat(parts), '[timeline.apply.setter]', 't')()
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

	local parts<const> = { 'return function(entry, value)\n' }
	if binding_index == 1 then
		append_path(parts, 'entry["primary_binding"]', path)
	else
		append_path(parts, 'entry["bindings"][' .. tostring(binding_index) .. ']', path)
	end
	parts[#parts + 1] = ' = value\nend'
	return load(table.concat(parts), '[timeline.apply.step]', 't')()
end

return timeline_apply
