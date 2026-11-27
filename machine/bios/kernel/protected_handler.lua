-- An ordinary ROM activation, entered by the firmware after unwinding the
-- protected body. The handler runs in the original context and mode; only its
-- first result is passed to the fixed vector for placement in the caller.
return function(handler, raised)
	local result<const> = handler(raised)
	blua32.svc(result)
	while true do end
end
