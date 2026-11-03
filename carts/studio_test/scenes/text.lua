local scenes<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local text_component<const> = require('cartlib/text/text_component')
local font<const> = require('cartlib/font')
local text_scene<const> = {}

-- The authored position is independent of construction-time text and a
-- presentation-only timeline. Content is a caller-supplied runtime binding;
-- registration alone is not enough to instantiate this composition.
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local initialized_caption<const> = {}
setmetatable(initialized_caption, { __index = object_2d })

function initialized_caption.initialize(owner)
	owner.caption = text_component.new(owner, { color = 0xff26a3bb })
	owner:add_component(owner.caption)
	owner.caption:set_text(string.upper(owner.content))
	local transport<const> = timeline_component.new(owner, { clock_mode = 'manual' })
	owner:add_component(transport)
	transport:define('presentation', {
		phase = 'presentation', duration_ms = 1000, bindings = { 'caption' },
		tracks = { { kind = 'spatial', binding = 'caption', operation = 'presentation_origin2',
			channels = { ox = { interpolation = 'step', keys = {
				{ time_ms = 0, value = 8 }, { time_ms = 500, value = 72 },
			} }, oy = 0 } } },
	}, { caption = owner.caption })
	transport:seek_time('presentation', 0)
end

function text_scene.register()
	font.define('studio_test.caption', {
		glyphs = {
			['S'] = 'tiny_3b_font_code_0x53', ['T'] = 'tiny_3b_font_code_0x54',
			['U'] = 'tiny_3b_font_code_0x55', ['D'] = 'tiny_3b_font_code_0x44',
			['I'] = 'tiny_3b_font_code_0x49', ['O'] = 'tiny_3b_font_code_0x4f',
			['?'] = 'tiny_3b_font_code_0x3f', [' '] = 'tiny_3b_font_code_0x20',
		},
		line_height = 10, advance_padding = 2,
	})
	prefab.define({ def_id = 'studio_test.caption', class = object_2d,
		defaults = { font = font.get('studio_test.caption'), text = 'STUDIO', color = 0xff26a3bb },
		components = { function(owner) return text_component.new(owner, owner) end } })
	prefab.define({ def_id = 'studio_test.default_text', class = object_2d,
		components = { text_component.factory({ text = 'Default', color = 0xffbd7841 }) } })
	scenes.register('studio_test.text', { objects = {
		{ member_id = 'caption', definition_id = 'studio_test.caption', position = { x = 32, y = 48 },
			options = { text = 'STUDIO' } },
		{ member_id = 'default', definition_id = 'studio_test.default_text', position = { x = 32, y = 80 } },
	} })
	prefab.define({ def_id = 'studio_test.initialized_caption', class = initialized_caption })
	scenes.register('studio_test.initialized_text', { objects = {
		{ member_id = 'caption', definition_id = 'studio_test.initialized_caption', position = { x = 16, y = 120 } },
	} })
end

return text_scene
