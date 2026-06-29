assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if select('#', ...) > 0 then
		error((select(1, ...)))
	end
	error('assertion failed!')
end
