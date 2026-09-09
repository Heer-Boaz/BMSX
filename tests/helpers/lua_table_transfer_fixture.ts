/** Independent authored source shared by syntax and actual Studio transfer gates. */
export const LUA_TABLE_TRANSFER_SOURCE = `local first<const> = { -- first header
	-- original first
	(10), -- first inline
	-- travelling documentation 🐉
	[("same")] = (({ value = 20, text = [==[literal , ; }]==] })); -- travelling inline
	30 -- last without separator
	-- first footer
}
local second<const> = { -- second header
	40, -- target first
	["same"] = 50 -- target last without separator
	-- second footer
}
return first, second
`;
