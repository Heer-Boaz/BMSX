-- Compiler scopes borrow physical activations. These records and their registry
-- are ordinary saved guest state, never CPU frame metadata.
-- The registry must not keep an otherwise unreachable suspended thread alive.
local active<const> = __bmsx_setmetatable({}, { __mode = 'k' })
local scopes<const> = { active = active }
local next<const> = __bmsx_next

function scopes.open(thread, owner_frame)
	local scope<const> = { thread = thread, owner_frame = owner_frame }
	active[scope] = true
	return scope
end

function scopes.close(scope)
	scope.thread = nil
	active[scope] = nil
end

function scopes.retire(thread, first_frame)
	for scope in next, active do
		if scope.thread == thread and scope.owner_frame >= first_frame then
			scopes.close(scope)
		end
	end
end

return scopes
