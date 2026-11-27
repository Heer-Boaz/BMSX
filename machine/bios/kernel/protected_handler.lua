return function(handler, raised)
	return false, (handler(raised))
end
