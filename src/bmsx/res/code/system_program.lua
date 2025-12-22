local message = "insert cart"

local function draw_insert_cart()
	cls(4)
	local width = display_width()
	local height = display_height()
	local text_width = #message * 6
	local x = math.floor((width - text_width) / 2)
	local y = math.floor((height - 8) / 2)
	write(message, x, y, 0, 15)
end

function init()
end

function new_game()
end

function update(dt)
	if cart_present() then
		boot_cart()
	end
end

function draw()
	draw_insert_cart()
end
