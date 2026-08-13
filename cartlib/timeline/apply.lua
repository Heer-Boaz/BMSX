local timeline_apply<const> = {}
local apply_source<const> = require('cartlib/timeline/apply_source')
local lua_syntax_printer<const> = require('cartlib/codegen/lua_syntax_printer')

local compile_frame_apply<const> = function(frame, shape_cache)
	local source<const> = lua_syntax_printer.print(apply_source.build_frame(frame))
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

	return load(
		lua_syntax_printer.print(apply_source.build_step(path, binding_index)),
		'[timeline.apply.step]',
		't'
	)()
end

return timeline_apply
