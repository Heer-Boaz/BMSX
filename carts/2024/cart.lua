module<entry>

local gx_display<const> = require('cartlib/gx/display')
local gx_texture<const> = require('cartlib/gx/texture')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()

local input<const> = require('cartlib/input/input')
local keyboard_input<const> = {
	up = { 'ArrowUp' },
	right = { 'ArrowRight' },
	down = { 'ArrowDown' },
	left = { 'ArrowLeft' },
	a = { 'KeyA' },
	b = { 'KeyB' },
	confirm = { 'KeyA', 'KeyB' },
}
local gamepad_input<const> = {
	up = { 'up' },
	right = { 'right' },
	down = { 'down' },
	left = { 'left' },
	a = { 'a' },
	b = { 'b' },
	confirm = { 'a', 'b' },
}
input.add_player(1)
input.push_context(1, 'sint2024', keyboard_input, gamepad_input)

local font<const> = require('cartlib/font')
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
local quiz<const> = require('quiz')
local sint<const> = require('sint')
local sint_font<const> = require('sint_font')

world:configure(world_module)

local function init<init>()
	sint_font.register()
	quiz.define_fsm()
	sint.define_fsm()
	quiz.register_definitions()
	sint.register_definition()
end

function new_game()
	world:clear()
	world:spawn(sint.portrait_def_id, {
		id = sint.portrait_instance_id,
		imgid = 'quiz',
		pos = { x = 0, y = 0, z = 0 },
	})
	local text<const> = world:spawn(quiz.text_def_id, {
		id = quiz.text_instance_id,
		font = font.get(sint_font.font_id),
		dimensions = { left = 0, right = 256, top = 16, bottom = 192 },
		blank_lines = 0,
		text_color = 0xffffffff,
		normal_bg_color = 0xff000000,
		pos = { x = 0, y = 0, z = 0 },
	})
	text.maximum_characters_per_line = 28
	world:spawn(quiz.controller_def_id, {
		id = quiz.controller_instance_id,
		text = text,
		pos = { x = 0, y = 0, z = 0 },
	})
end

init()
gx_texture.upload('quiz')
new_game()
vblank.wait()

while true do
	world:update()
	vblank.wait()
	world:render()
end
