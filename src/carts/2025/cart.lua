local states = {
	title = 'title',
	game = 'game',
}

local gamestate = states.title

local function draw_title()
	sprite('titel', 0, 0, 0)
end

local function draw_game()
	cls(4)
end

local draw_handlers = {
	title=draw_title,
	game=draw_game,
}

local function update_title()
	if action_triggered('a[jp]') then
		$.stopmusic()
		gamestate = states.game
	end
end

local function update_game()
end

local update_handlers = {
	title=update_title,
	game=update_game,
}

function init()
	print 'init!!!'
end

function new_game()
	$.playaudio('m02')
end

function update()
	print(gamestate)
	update_handlers[gamestate]()
end

function draw()
	draw_handlers[gamestate]()
end
