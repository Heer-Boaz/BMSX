-- The castle disposes the outgoing room before spawning the next one.
-- Reuse its 32 x 20 tile grid; dynamic objects keep their own collision.
bss active_tiles: u8[640]
local cells<const>: *u8 = active_tiles
local wall<const> = string.byte('#')
local seal<const> = string.byte('$')
local left<const>, alternate_left<const> = string.byte('-'), string.byte('_')
local right<const>, alternate_right<const> = string.byte('='), string.byte('+')

local collision<const> = { tiles = active_tiles, wall = wall }

function collision.rebuild(room)
	local template<const> = room.template
	local opened<const> = room.terrain == template.terrain.stairs_open
	local cleared<const> = room.terrain == template.terrain.seal_cleared
	local width<const>, height<const> = room.tile_columns, room.tile_rows
	for y = 1, height do
		local row = template.map_rows[y]
		if opened and template.stair_rows[y] then row = template.stair_rows[y] end
		local start<const> = (y - 1) * width
		for x = 1, width do
			local tile = string.byte(row, x)
			if tile == seal then tile = cleared and 0 or wall end
			cells[start + x - 1] = tile
		end
	end
	for _, door in ipairs(room.draaideuren) do
		local i<const> = (door.tile_y - 1) * width + door.tile_x - 1
		cells[i], cells[i + width], cells[i + width * 2] = 0, 0, 0
	end
	for _, rock in ipairs(room.rocks) do
		if not room.progress.destroyed_rocks[rock.member_id] then
			local x<const>, y<const> = room:world_to_tile(rock.x, rock.y)
			local i<const> = (y - 1) * width + x - 1
			cells[i], cells[i + 1] = wall, wall
			cells[i + width], cells[i + width + 1] = wall, wall
		end
	end

	local stairs<const> = room.stairs
	local count = 0
	for x = 0, width - 2 do
		local first = -1
		for y = 0, height do
			local paired = false
			if y < height then
				local i<const> = y * width + x
				local tile<const> = cells[i]
				if tile == left or tile == alternate_left then
					local partner<const> = cells[i + 1]
					paired = partner == right or partner == alternate_right
				end
			end
			if paired then
				if first < 0 then first = y end
			elseif first >= 0 then
				count = count + 1
				stairs[count] = x | (first << 8) | (y << 16)
				first = -1
			end
		end
	end
	room.stair_count = count
end

return collision
