-- Timeline clock sources are raw retained-lane bits. Gameplay and frame consume
-- their respective configured schedule quanta; gameplay can be suspended while
-- frame work remains admitted. Platform follows SYS_TIME_MS, audio follows the
-- APU sample clock, and manual timelines advance only through explicit transport
-- operations.
local clock<const> = require('cartlib/clock')

local gameplay<const> = clock.gameplay
local frame<const> = clock.frame
local platform<const> = 0x04
local audio<const> = 0x08
local manual<const> = 0x00

return {
	gameplay = gameplay,
	frame = frame,
	platform = platform,
	audio = audio,
	manual = manual,
}
