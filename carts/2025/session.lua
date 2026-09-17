-- Story progress outlives its dialogue, combat and transition presentation.
local session<const> = {}

function session.new()
	return {
		node_id = 'title',
		stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 },
		inline_pages = {},
	}
end

return session
