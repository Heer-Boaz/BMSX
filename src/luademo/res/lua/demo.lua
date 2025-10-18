local state = {
	frame = 0,
	paletteIndex = 1,
	squares = {},
}

local palette = { 6, 8, 10, 12, 14 }

local function create_square(seed)
	local size = math.random(4, 8)
	return {
		x = math.random(size, 128 - size),
		y = math.random(size, 128 - size),
		vx = math.random() * 60 - 30,
		vy = math.random() * 60 - 30,
		size = size,
		seed = seed,
	}
end

local function reset_squares()
	state.squares = {}
	math.randomseed(os.time())
	for i = 1, 8 do
		table.insert(state.squares, create_square(i))
	end
end

function init()
	math.randomseed(os.time())
	state.frame = 0
	state.paletteIndex = 1
	reset_squares()
	api.cartdata('lua-demo')
end

local function update_square(square, delta)
	square.x = square.x + square.vx * delta
	square.y = square.y + square.vy * delta

	if square.x < square.size then
		square.x = square.size
		square.vx = -square.vx
	elseif square.x > 128 - square.size then
		square.x = 128 - square.size
		square.vx = -square.vx
	end

	if square.y < square.size then
		square.y = square.size
		square.vy = -square.vy
	elseif square.y > 128 - square.size then
		square.y = 128 - square.size
		square.vy = -square.vy
	end
end

function update(delta)
	state.frame = state.frame + 1

	for _, square in ipairs(state.squares) do
		update_square(square, delta)
	end

	if api.btnp(4) then
		state.paletteIndex = state.paletteIndex % #palette + 1
	end

	if api.btnp(5) then
		reset_squares()
	end
end

local function draw_square(square, color)
	local half = square.size
	local left = math.floor(square.x - half)
	local top = math.floor(square.y - half)
	local right = math.floor(square.x + half)
	local bottom = math.floor(square.y + half)
	api.rectfill(left, top, right, bottom, color)
end

function draw()
	api.cls(0)
	api.print('Lua Demo', 38, 10, palette[state.paletteIndex])
	api.print('O: cycle colors', 16, 24, 7)
	api.print('X: shuffle squares', 8, 32, 7)
	api.print('Frame: ' .. state.frame, 12, 46, 10)

	for index, square in ipairs(state.squares) do
		local color = palette[((state.paletteIndex + index - 2) % #palette) + 1]
		draw_square(square, color)
	end
end
