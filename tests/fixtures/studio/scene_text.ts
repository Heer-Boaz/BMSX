import { SCENE_VIEWPORT_IMPORTS } from './scene_viewport';

export const SCENE_FONT_MODULES = [
	['cartlib/text/font_catalog.lua', 'local catalog={}; function catalog.get(id) end; function catalog.replace(id,definition) end; return catalog'],
	['cartlib/font.lua', "local catalog=require('cartlib/text/font_catalog'); local font={get=catalog.get}; function font.define(id,definition) catalog.replace(id,definition) end; return font"],
] as const;

export const SCENE_TEXT_MODULES = [...SCENE_VIEWPORT_IMPORTS, ...SCENE_FONT_MODULES,
	['cartlib/text/text_component.lua', 'return {new=function() end,factory=function() end}'],
] as const;

export const SCENE_TEXT_SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local text_component=require('cartlib/text/text_component')
local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='glyph_a',['?']='glyph_question',[' ']='glyph_space'},line_height=8,advance_padding=1})
prefab.define({def_id='caption',class=require('cartlib/world/object_2d'),defaults={font=font.get('custom')},
 components={function(owner) return text_component.new(owner,owner) end}})
scenes.register('text',{objects={{member_id='caption',definition_id='caption',options={text='A'}}}})
`;
