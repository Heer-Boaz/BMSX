return function(...)
	blua32.svc(nil)
	-- A successful transfer retires this frame in its caller's window.
	-- Only a refused yield resumes execution here.
	__bmsx_error('Invalid argument.')
end
