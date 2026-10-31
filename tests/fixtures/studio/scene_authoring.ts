import { CARTLIB_OBJECT_SOURCE_MODULES } from './cartlib_objects';
export const SCENE_AUTHORING_IMPORTS = [...CARTLIB_OBJECT_SOURCE_MODULES, ['cartlib/world/prefab.lua','return {define=function() end}']] as const;
/** Source-owned UI fixture, independent of game carts and runtime actor identities. */
export const SCENE_AUTHORING_SOURCE = `local scenes = require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='fixture.actor',class=require('cartlib/world/object_3d')})
prefab.define({def_id='fixture.other',class=require('cartlib/world/object_3d')})
prefab.define({def_id='fixture.subject',class=require('cartlib/world/object_3d')})
prefab.define({def_id='fixture.last',class=require('cartlib/world/object_3d')})
scenes.register('fixture.room', { objects = {
	{ member_id = 'first', definition_id = 'fixture.actor', position = { x = 1, y = 2, z = 3 } },
	{ member_id = 'second', definition_id = 'fixture.other', position = { x = 4, y = 5, z = 6 } },
	{ member_id = 'subject', definition_id = 'fixture.subject', position = { x = 0, y = 0, z = 0 }, options = { tint = 0xffabcdef } },
	{ member_id = 'last', definition_id = 'fixture.last', position = { x = 7, y = 8, z = 9 } },
} })
return {}
`;
