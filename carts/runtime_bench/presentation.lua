local world<const> = require('cartlib/world/world')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local visual_component<const> = require('cartlib/component/visual_component')
local text_component<const> = require('cartlib/text/text_component')
local simulation<const> = require('simulation')

local presentation<const> = {}
local names<const> = { 'LUA TABLES', 'WORLD NO DRAW', 'WORLD DRAW' }
local colors<const> = { 0xff63d7ff, 0xffffcf59, 0xffec7b9f, 0xff82e29a }
local caption

local draw_rows<const> = function(_component, draw)
	local state<const> = simulation.state
	local rows<const> = simulation.rows()
	for index = 1, #rows do
		local row<const> = state.mode == 1 and rows[index] or rows[index].state
		draw:rect(row.x + 6, row.y + 70, row.x + 9, row.y + 73, colors[row.index % 4 + 1])
	end
end

local create_visual<const> = function(owner)
	local visual<const> = visual_component.new(owner, nil, 'rows')
	visual:set_draw_function(draw_rows)
	return visual
end

function presentation.install()
	prefab.define({ def_id = 'bench.visual', components = { create_visual } })
	prefab.define({ def_id = 'bench.caption', class = object_2d,
		components = { text_component.factory({ id_local = 'text', color = 0xffffffff }) } })
end

function presentation.reset()
	world:spawn('bench.visual')
	local label<const> = world:spawn('bench.caption', { position = { x = 8, y = 8 } })
	caption = label:get_component(text_component)
	presentation.refresh()
	-- One selection card is intentionally presented in every mode. The no-draw
	-- phases issue no further rendering until another selection or restart.
	world:render()
end

function presentation.refresh()
	local state<const> = simulation.state
	caption:set_text('RUNTIME BENCH  ' .. names[state.mode]
		.. '\nROWS ' .. state.count .. '  STEP ' .. state.steps .. '/' .. state.target_steps
		.. '\nWORK ' .. state.work .. '  CHECK ' .. state.checksum
		.. '\nLEFT/RIGHT MODE  UP/DOWN SIZE  X/PAD A RESTART'
		.. '\n' .. (state.finished and 'COMPLETE - RESTART FOR ANOTHER FIXED RUN' or 'RUNNING FIXED WORK; NO HOST-TIME RANDOMNESS'))
end

return presentation
