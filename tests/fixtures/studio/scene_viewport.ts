import { CARTLIB_OBJECT_SOURCE_MODULES } from './cartlib_objects';

export const SCENE_VIEWPORT_IMPORTS = [...CARTLIB_OBJECT_SOURCE_MODULES, ['cartlib/world/prefab.lua', 'return {define=function() end}']] as const;

/** Independent authored source; no shipped cart, runtime objects, or line-number oracle. */
export const SCENE_VIEWPORT_SOURCE = `local viewport_scenes = require('cartlib/world/scene_library')
local viewport_prefab = require('cartlib/world/prefab')
viewport_prefab.define({def_id='proof.actor',class=require('cartlib/world/object_3d')})
viewport_prefab.define({def_id='proof.dynamic',class=require('cartlib/world/object_3d')})
local function compute_x() return 14 end
local function compute_z() return 42 end
viewport_scenes.register('viewport proof with a deliberately long scene name', {
	objects = {
		{ member_id = 'subject', definition_id = 'proof.actor', position = { x = 11, y = -22, z = 33 }, options = { color = 0xffabcdef, visible = true, region = { width = 16, height = 24 } } },
		{ member_id = 'source only', definition_id = 'proof.dynamic', position = { x = compute_x(), y = 2, z = compute_z() } },
	},
})
`;
