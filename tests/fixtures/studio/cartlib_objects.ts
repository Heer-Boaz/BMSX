/** Concrete synthetic class publications, not transform-shape annotations. */
export const CARTLIB_OBJECT_SOURCE_MODULES = [
	['cartlib/world/world_object.lua', 'return {}'],
	['cartlib/world/object_2d.lua', "local object={}; setmetatable(object,{__index=require('cartlib/world/world_object')}); return object"],
	['cartlib/world/object_3d.lua', "local object={}; setmetatable(object,{__index=require('cartlib/world/world_object')}); return object"],
] as const;
