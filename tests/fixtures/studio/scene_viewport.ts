/** Independent authored source; no shipped cart, runtime objects, or line-number oracle. */
export const SCENE_VIEWPORT_SOURCE = `local viewport_scenes = require('cartlib/world/scene_library')
local function compute_x() return 14 end
local function compute_z() return 42 end
viewport_scenes.register('viewport proof with a deliberately long scene name', {
	objects = {
		{ member_id = 'subject', definition_id = 'proof.actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 11, -22, 33 } }, options = { color = 0xffabcdef, visible = true, region = { width = 16, height = 24 } } },
		{ member_id = 'source only', definition_id = 'proof.dynamic', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, compute_x(), 2, compute_z() } } },
	},
})
`;
