return function(retained, retire_scopes)
	-- Ordinary software closes any borrowed scopes before the vector retires
	-- their physical frames. A System without the debugger has no such scopes.
	if retire_scopes ~= nil then
		retire_scopes(__bmsx_coroutine_running(), retained)
	end
	blua32.svc(retained)
end
