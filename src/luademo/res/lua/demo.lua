local state = {
	frame = 0,
	paletteIndex = 1,
	balls = {},
}

local palette = { 6, 8, 10, 12, 14 }
local BALL_ID = 'ball'
local BALL_SIZE = 8
local BALL_RADIUS = BALL_SIZE / 2

local function create_ball(seed)
	return {
		x = math.random(BALL_RADIUS, 128 - BALL_RADIUS),
		y = math.random(BALL_RADIUS, 128 - BALL_RADIUS),
		vx = math.random() * 60 - 30,
		vy = math.random() * 60 - 30,
		radius = BALL_RADIUS,
		seed = seed,
	}
end

local function reset_balls()
	state.balls = {}adsfass
	math.randomseed(os.time())
	for i = 1, 8 do
		table.insert(state.balls, create_ball(i))
	end
end

function init()
	math.randomseed(os.time())
	state.frame = 0
	state.paletteIndex = 1
	reset_balls()
	cartdata('lua-demo')
end

local function update_ball(ball, delta)
	ball.x = ball.x + ball.vx * delta
	ball.y = ball.y + ball.vy * delta

	if ball.x < ball.radius then
		ball.x = ball.radius
		ball.vx = -ball.vx
	elseif ball.x > 128 - ball.radius then
		ball.x = 128 - ball.radius
		ball.vx = -ball.vx
	end

	if ball.y < ball.radius then
		ball.y = ball.radius
		ball.vy = -ball.vy
	elseif ball.y > 128 - ball.radius then
		ball.y = 128 - ball.radius
		ball.vy = -ball.vy
	end
end

function update(delta)
	state.frame = state.frame + 1

	for _, ball in ipairs(state.balls) do
		update_ball(ball, delta)
	end

	if btnp(4) then
		state.paletteIndex = state.paletteIndex % #palette + 1
	end

	if btnp(5) then
		reset_balls()
	end
end

local function draw_ball(ball, color)
	local left = math.floor(ball.x - ball.radius)
	local top = math.floor(ball.y - ball.radius)
	spr(BALL_ID, left, top, { color = color })
	-- rect(left, top, left + BALL_SIZE, top + BALL_SIZE, color)
end

function draw()
	cls(0)
	print('Lua Demo', 38, 10, palette[state.paletteIndex])
	print('O: cycle colors', 16, 24, 7)
	print('X: shuffle balls', 16, 32, 7)
	print('Frame: ' .. state.frame, 12, 46, 10)

	for index, ball in ipairs(state.balls) do
		local color = palette[((state.paletteIndex + index - 2) % #palette) + 1]
		draw_ball(ball, color)
	end
end
