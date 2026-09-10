/** Independent authored source; no shipped cart, runtime objects, or line-number oracle. */
export const SCENE_VIEWPORT_SOURCE = `local viewport_scenes<const> = require('cartlib/world/scene_library')
local function compute_x() return 14 end
local function compute_z() return 42 end
viewport_scenes.register('viewport proof with a deliberately long scene name', {
	objects = {
		{ member_id = 'subject', definition_id = 'proof.actor', options = { pos = { x = 11, y = -22, z = 33 } } },
		{ member_id = 'source only', definition_id = 'proof.dynamic', options = { pos = { x = compute_x(), y = 2, z = compute_z() } } },
	},
})
`;
