assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if select('#', ...) > 0 then
		error((select(1, ...)))
	end
	error('assertion failed!')
end

local ipairs_iterator<const> = function(target, index)
	local next_index<const> = index + 1
	local value<const> = target[next_index]
	if value == nil then
		return nil
	end
	return next_index, value
end


ipairs = function(target)
	return ipairs_iterator, target, 0
end
