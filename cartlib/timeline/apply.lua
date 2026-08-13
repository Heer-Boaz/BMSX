local timeline_apply<const> = {}
local apply_source<const> = require('cartlib/timeline/apply_source')
local compile_syntax<const> = lua_compiler.compile_syntax

local nested_shape<const> = {}
local leaf_shape<const> = {}
local close_shape<const> = {}
local complete_shape<const> = {}

local retain_frame_shape
retain_frame_shape = function(cache, frame)
	for key, value in pairs(frame) do
		local next_cache = cache[key]
		if next_cache == nil then
			next_cache = {}
			cache[key] = next_cache
		end
		cache = next_cache
		local shape = leaf_shape
		if type(value) == 'table' then
			shape = nested_shape
		end
		next_cache = cache[shape]
		if next_cache == nil then
			next_cache = {}
			cache[shape] = next_cache
		end
		cache = next_cache
		if shape == nested_shape then
			cache = retain_frame_shape(cache, value)
			next_cache = cache[close_shape]
			if next_cache == nil then
				next_cache = {}
				cache[close_shape] = next_cache
			end
			cache = next_cache
		end
	end
	return cache
end

function timeline_apply.compile_frames(frames)
	local frame_appliers<const> = {}
	local applier_by_frame<const> = {}
	local shape_cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		local apply_frame = applier_by_frame[frame]
		if apply_frame == nil then
			local shape<const> = retain_frame_shape(shape_cache, frame)
			apply_frame = shape[complete_shape]
			if apply_frame == nil then
				apply_frame = compile_syntax(
					apply_source.build_frame(frame),
					'[timeline.apply.frame]'
				)()
				shape[complete_shape] = apply_frame
			end
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

	return compile_syntax(
		apply_source.build_step(path, binding_index),
		'[timeline.apply.step]'
	)()
end

return timeline_apply
