local y = 0 
-- new lua resource
function draw()
	cls(4)
	write('bla',0,200,1)
	bla(y)
	-- asdfsdfsdsdff
end

function update()
	y = y + 1
end

function test(b)
	y = b
end