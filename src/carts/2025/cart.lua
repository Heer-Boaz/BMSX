local states = {
	title = 'title',
	game = 'game',
	overgang = 'overgang',
}

local gamestate = states.title

local function draw_title()
	sprite('titel', 0, 0, 0)
end

local overgang_x = 0
local overgang_y = 64
local function init_overgang()
	overgang_x = display_width
end

local function draw_overgang()
	write('MONDAY', overgang_x, overgang_y, 0, 15)
end

local function update_overgang()
	overgang_x -= 4
	if overgang_x < -48 then
		emit_gameplay('overgang_klaar', 'world')
	end
end

local function draw_game()
	cls(4)
end

local function update_title()
	if action_triggered('a[jp]') then
		$.stopmusic()
		$.playaudio('m05')
		gamestate = states.overgang
	end
end

local function update_game()
end

local update_handlers = {
	title=update_title,
	game=update_game,
	overgang=update_overgang,
}

local draw_handlers = {
	title=draw_title,
	game=draw_game,
	overgang=draw_overgang,
}

function init()
	print 'init!!!'
end

function new_game()
	$.playaudio('m02')
end

function update()
	-- print(gamestate)
	update_handlers[gamestate]()
end

function draw()
	draw_handlers[gamestate]()
end
