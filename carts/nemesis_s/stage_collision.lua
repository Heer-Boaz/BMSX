local stage_collision<const> = {}

local solid_roles<const> = {
	[33] = true, -- ! collision-only masonry
	[35] = true, -- # house
	[37] = true, -- % alternating ground
	[40] = true, -- ( left wall
	[41] = true, -- ) right wall
	[43] = true, -- + center wall
	[45] = true, -- - ground
	[61] = true, -- = alternate ground
	[64] = true, -- @ roof
	[82] = true, -- R smoke-generator masonry
	[83] = true, -- S chimney-enemy masonry
	[94] = true, -- ^ roof peak
	[95] = true, -- _ vertical ground
	[100] = true, -- d door
	[115] = true, -- s chimney
	[119] = true, -- w window
}

local tree_center_solidity<const> = {
	[49] = false, -- 1: the upper tree center stays open
	[50] = true,
	[51] = true,
	[52] = true,
	[53] = true,
	[54] = true,
	[55] = true,
}

function stage_collision.is_solid(role, row, roles, x, width)
	if role == 116 then -- t: right-hand tree markers take precedence
		if x < width then
			local id<const> = row[x + 1]
			if id ~= 0 then
				local right<const> = tree_center_solidity[roles[id]]
				if right ~= nil then return right end
			end
		end
		if x > 1 then
			local id<const> = row[x - 1]
			if id ~= 0 then return not not tree_center_solidity[roles[id]] end
		end
		return false
	end
	if role >= 49 and role <= 54 then -- 1..6: only the middle tree tile is solid
		return x > 1 and roles[row[x - 1]] == 116
	end
	return not not solid_roles[role]
end

return stage_collision
