import { SCENE_VIEWPORT_IMPORTS } from './scene_viewport';

/** Synthetic publications preserve callable/prototype identities without a cart or a guest World. */
export const SCENE_ANIMATION_SPRITE_MODULE = `local component=require('cartlib/component/sprite_component')
local sprite={primary_sprite_factory=component.new}
setmetatable(sprite,{__index=require('cartlib/world/object_2d')})
function sprite.initialize(self) end
return sprite`;

export const SCENE_ANIMATION_MODULES = [...SCENE_VIEWPORT_IMPORTS,
	['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
	['cartlib/component/sprite_animation_component.lua', 'return {factory=function() end}'],
	['cartlib/sprite.lua', SCENE_ANIMATION_SPRITE_MODULE],
] as const;

export const SCENE_ANIMATION_IMPORTS = `local prefab=require('cartlib/world/prefab')
local object=require('cartlib/world/object_2d')
local sprite_object=require('cartlib/sprite')
local sprites=require('cartlib/component/sprite_component')
local animation=require('cartlib/component/sprite_animation_component')
`;

export const SCENE_NAMED_ANIMATION = `animation.factory({animation='idle',animations={
 idle={frames={'idle_first','idle_second'}},run={frames={'run_first','run_second'}}}})`;
