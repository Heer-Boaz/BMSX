local gamestate = 'game'
local draw_handlers = {
	title=function()
		cls(2)
	end,
	game=function()
		cls(6)
	end,
}

function init()
	print 'init!!!'
end

function new_game()
	$.playaudio('m02')
end

function update()
end

function draw()
	draw_handlers[gamestate]()
end
