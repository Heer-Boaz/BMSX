import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneFontSources } from '../../ide/workbench/contrib/scene_editor/font_sources';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { createPathModuleProjectFixture } from '../helpers/lua_semantic_project';
import { SCENE_FONT_MODULES } from '../fixtures/studio/scene_text';

/** Only synthetic authored modules: no cart execution, project assets or cart IO. */
function fixture(source: string, providers: readonly (readonly [string, string])[] = []) {
	const files = [...new Map<string, string>([['main.lua', source], ...SCENE_FONT_MODULES, ...providers])]
		.map(([path, source]) => ({ path, source }));
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files));
	const file = snapshot.getFileData('main.lua')!, reader = new LuaSourceReader(snapshot), fonts = new SceneFontSources(reader);
	const expression = file.moduleValues[0].statement.expressions[0];
	const sourceExpression = snapshot.symbolResolver.writtenSources.expression(file, expression);
	return { snapshot, file, reader, fonts, source: sourceExpression, resolve: () => fonts.resolve(file, sourceExpression) };
}

test('proved absent and nil fonts select the exact builtin default, unresolved values do not', () => {
	const f = fixture('return nil'), font = f.fonts.resolve(f.file, null)!;
	assert.equal(f.fonts.resolve(f.file, f.source), font);
	assert.equal(f.fonts.resolve(f.file, undefined), undefined);
	assert.equal(font.lineHeight, 6); assert.equal(font.advancePadding, 0);
	assert.equal(font.glyphs.size, 95);
	for (let codepoint = 0x20; codepoint <= 0x7e; codepoint += 1)
		assert.equal(font.glyphs.get(codepoint), `tiny_3b_font_code_0x${codepoint.toString(16)}`);
	assert.equal(font.glyphs.has(9), false, 'tab advance synthesis belongs to layout, not source registrations');
	assert.equal(fixture('return choose_font()').resolve(), undefined);
	assert.equal(fixture("return 'default'").resolve(), undefined, 'text_component accepts a resolved font, not an id string');
});

test('font.define and public getter aliases retain literal maps, concatenated identities and source metrics', () => {
	const f = fixture(`local font=require('font_bridge')
local define=font.define
local get=font.get
local prefix='scene'
local key='A'
local glyphs={[key]='atlas'..'_A',['?']='atlas_question',space='atlas_space'}
local definition={glyphs=glyphs,advance_padding=-2,line_height=11}
define(prefix..'_font',definition)
local resolved=get(prefix..'_font')
return resolved`, [['font_bridge.lua', "return require('cartlib/font')"]]);
	const font = f.resolve()!;
	assert.deepEqual([...font.glyphs], [[65, 'atlas_A'], [63, 'atlas_question'], [115, 'atlas_space']]);
	assert.equal(font.advancePadding, -2); assert.equal(font.lineHeight, 11);
	assert.equal(f.fonts.resolve(f.file, f.source), font, 'the snapshot retains one projected font object');
});

test('catalog.get consumes the same registrations and preserves Lua or default semantics', () => {
	for (const fields of ['', ',advance_padding=nil,line_height=nil', ',advance_padding=false,line_height=false']) {
		const f = fixture(`local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='img_a',['?']='img_question'}${fields}})
return require('cartlib/text/font_catalog').get('custom')`);
		const font = f.resolve()!;
		assert.equal(font.advancePadding, 0); assert.equal(font.lineHeight, undefined);
	}
	const f = fixture(`local font=require('cartlib/font')
font.define('zero',{glyphs={['A']='img_a'},advance_padding=0,line_height=0})
return font.get('zero')`);
	assert.equal(f.resolve()!.lineHeight, 0);
});

test('direct catalog replacements and imported callable aliases provide source registrations', () => {
	for (const registration of [
		"require('cartlib/text/font_catalog').replace('custom',definition)",
		"local catalog=require('cartlib/text/font_catalog'); catalog.replace('custom',definition)",
		"local catalog=require('catalog_bridge'); local replace=catalog.replace; replace('custom',definition)",
	]) {
		const f = fixture(`local definition={glyphs={['A']='custom_a',['?']='question'},advance_padding=2,line_height=8}
${registration}
return require('cartlib/font').get('custom')`, [['catalog_bridge.lua', "return require('cartlib/text/font_catalog')"]]);
		const font = f.resolve()!;
		assert.deepEqual([...font.glyphs], [[65, 'custom_a'], [63, 'question']], registration);
		assert.equal(font.advancePadding, 2); assert.equal(font.lineHeight, 8);
	}
});

test('direct default replacement owns both explicit and implicit default fonts', () => {
	const f = fixture(`local catalog=require('cartlib/text/font_catalog')
catalog.replace('default',{glyphs={['A']='custom_a'},line_height=8})
return catalog.get('default')`);
	const font = f.resolve()!;
	assert.deepEqual([...font.glyphs], [[65, 'custom_a']]);
	assert.equal(font.lineHeight, 8);
	assert.equal(f.fonts.resolve(f.file, null), font);
});

test('direct replacement retains unknown and mutated definitions without exposing builtin defaults', () => {
	for (const registration of [
		"catalog.replace('default',unknown_definition)",
		"catalog.replace('default',{glyphs=make_glyphs()})",
		"local glyphs={['A']='first'}; glyphs['B']='later'; catalog.replace('default',{glyphs=glyphs})",
		"local definition={glyphs={['A']='first'}}; definition.line_height=choose_height(); catalog.replace('default',definition)",
		"catalog.replace('default',{glyphs={['A']='a'},advance_padding=choose_padding()})",
		"catalog.replace(choose_id(),{glyphs={['A']='a'}})",
	]) {
		const f = fixture(`local catalog=require('cartlib/text/font_catalog')
${registration}
return catalog.get('default')`);
		assert.equal(f.resolve(), undefined, registration);
		assert.equal(f.fonts.resolve(f.file, null), undefined, registration);
	}
});

test('define and replace writes compete for the same identities and unknown ids revoke all registrations', () => {
	for (const registration of [
		"catalog.replace('default',{glyphs={['A']='a'}}); catalog.replace('default',{glyphs={['B']='b'}})",
		"font.define('default',{glyphs={['A']='a'}}); catalog.replace('default',{glyphs={['B']='b'}})",
		"catalog.replace('default',{glyphs={['A']='a'}}); font.define('default',{glyphs={['B']='b'}})",
		"font.define('default',{glyphs={['A']='a'}}); catalog.replace(choose_id(),{glyphs={['B']='b'}})",
		"local replace=catalog.replace; replace(choose_id(),{glyphs={['B']='b'}})",
	]) {
		const f = fixture(`local catalog=require('cartlib/text/font_catalog'); local font=require('cartlib/font')
${registration}
return catalog.get('default')`);
		assert.equal(f.resolve(), undefined, registration);
		assert.equal(f.fonts.resolve(f.file, null), undefined, registration);
	}
	const custom = fixture(`local catalog=require('cartlib/text/font_catalog')
catalog.replace('custom',{glyphs={['A']='known'}})
catalog.replace(choose_id(),{glyphs={['B']='unknown'}})
return catalog.get('custom')`);
	assert.equal(custom.resolve(), undefined);
});

test('only the define callable own parameter-forwarding application is excluded from registrations', () => {
	const fontModule = `local catalog=require('cartlib/text/font_catalog')
local font={get=catalog.get}
function font.define(id,definition)
 local resolved=catalog.replace(id,definition)
 if resolved==nil then return end
 refresh_components(resolved)
end
catalog.replace('default',{glyphs={['A']='module_a'},line_height=9})
return font`;
	const f = fixture(`local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='custom_a'}})
return font.get('default')`, [['cartlib/font.lua', fontModule]]);
	assert.deepEqual([...f.resolve()!.glyphs], [[65, 'module_a']]);
	assert.equal(f.resolve()!.lineHeight, 9);
	assert.equal(f.fonts.resolve(f.file, null), f.resolve());
	const relocated = fixture(`local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='relocated_a'}})
return font.get('custom')`, [
		['cartlib/font.lua', "local catalog=require('cartlib/text/font_catalog'); return {get=catalog.get,define=require('font_definition')}"],
		['font_definition.lua', "local catalog=require('cartlib/text/font_catalog'); return function(id,definition) catalog.replace(id,definition) end"],
	]);
	assert.equal(relocated.resolve()!.glyphs.get(65), 'relocated_a', 'the callable source owns forwarding independently of its filename');
	for (const body of [
		'catalog.replace(definition,id)',
		'id=choose_id(); catalog.replace(id,definition)',
		'definition.glyphs=make_glyphs(); catalog.replace(id,definition)',
		'catalog.replace(id,definition); catalog.replace(id,definition)',
		'local function nested(id,definition) catalog.replace(id,definition) end; nested(id,definition)',
	]) {
		const changed = fixture(`local font=require('cartlib/font')
font.define('default',{glyphs={['A']='unproved'}})
return font.get('default')`, [['cartlib/font.lua', `local catalog=require('cartlib/text/font_catalog')
local font={get=catalog.get}; function font.define(id,definition) ${body} end; return font`]]);
		assert.equal(changed.resolve(), undefined, body);
		assert.equal(changed.fonts.resolve(changed.file, null), undefined, body);
	}
	const unrelated = fixture("return require('cartlib/font').get('default')", [['cartlib/font.lua', fontModule.replace(
		'catalog.replace(\'default\'', "local function other(id,definition) catalog.replace(id,definition) end\ncatalog.replace('default'")]]);
	assert.equal(unrelated.resolve(), undefined, 'another function with identically named parameters is not the define owner');
});

test('competing replacement callable writes revoke direct and forwarded registrations', () => {
	for (const mutation of [
		'catalog.replace=function(id,definition) end',
		'catalog.replace=choose_replace()',
		'catalog[choose_key()]=function(id,definition) end',
	]) {
		for (const registration of [
			"catalog.replace('default',{glyphs={['A']='unproved'}})",
			"local replace=catalog.replace; replace('default',{glyphs={['A']='unproved'}})",
			"font.define('default',{glyphs={['A']='unproved'}})",
		]) {
			const f = fixture(`local catalog=require('cartlib/text/font_catalog'); local font=require('cartlib/font')
${mutation}
${registration}
return catalog.get('default')`);
			assert.equal(f.resolve(), undefined, `${mutation}: ${registration}`);
			assert.equal(f.fonts.resolve(f.file, null), undefined, `${mutation}: ${registration}`);
		}
	}
});

test('glyph keys follow BLua string.byte first-codepoint behavior, not UTF8 storage bytes', () => {
	const f = fixture(`local font=require('cartlib/font')
font.define('unicode',{glyphs={['é']='accent',['😀tail']='astral',['AB']='latin'}})
return font.get('unicode')`);
	assert.deepEqual([...f.resolve()!.glyphs], [[0xe9, 'accent'], [0x1f600, 'astral'], [0x41, 'latin']]);
	const collision = fixture(`local font=require('cartlib/font')
font.define('collision',{glyphs={['Ax']='first',['Ay']='second'}})
return font.get('collision')`);
	assert.equal(collision.resolve(), undefined, 'pairs order cannot choose the first-codepoint collision winner');
});

test('literal glyph-table writes settle before first-codepoint collisions are projected', () => {
	const repeated = fixture(`local font=require('cartlib/font')
font.define('repeated',{glyphs={['A']='first',['A']='final'}})
return font.get('repeated')`);
	assert.deepEqual([...repeated.resolve()!.glyphs], [[65, 'final']]);
	const equivalent = fixture(`local font=require('cartlib/font')
font.define('equivalent',{glyphs={['Ax']='earlier',['Ay']='shared',['Ax']='shared'}})
return font.get('equivalent')`);
	assert.deepEqual([...equivalent.resolve()!.glyphs], [[65, 'shared']]);
});

test('source registrations override default and explicit unknown/default overrides never reveal builtin glyphs', () => {
	const custom = fixture(`local font=require('cartlib/font')
font.define('default',{glyphs={['A']='custom_a'},line_height=8})
return font.get('default')`);
	assert.deepEqual([...custom.resolve()!.glyphs], [[65, 'custom_a']]);
	assert.equal(custom.fonts.resolve(custom.file, null), custom.resolve());
	for (const registration of [
		"font.define('default',unknown_definition)",
		"font.define('default',{glyphs=make_glyphs()})",
		"font.define('default',{glyphs={['A']='a'}}); font.define('default',{glyphs={['B']='b'}})",
		"font.define(choose_id(),{glyphs={['A']='a'}})",
	]) {
		const f = fixture(`local font=require('cartlib/font')\n${registration}\nreturn font.get('default')`);
		assert.equal(f.resolve(), undefined, registration);
		assert.equal(f.fonts.resolve(f.file, null), undefined, registration);
	}
	assert.equal(fixture("return require('cartlib/font').get('unknown')").resolve(), undefined);
});

test('computed, mutated and partially unknown glyph maps stay unresolved as a whole', () => {
	for (const construction of [
		"local glyphs={['A']='known'}; glyphs['B']='later'",
		"local glyphs={['A']='known'}; local alias=glyphs; alias[choose_key()]='later'",
		"local glyphs={}; for code=32,126 do glyphs[string.char(code)]='glyph_'..code end",
		"local glyphs={['A']='known',[choose_key()]='unknown'}",
		"local glyphs={['A']='known',['B']=choose_image()}",
		"local glyphs={['A']='known',['']='invalid'}",
		"local glyphs={['A']='known','array'}",
	]) {
		const f = fixture(`local font=require('cartlib/font')
${construction}
font.define('custom',{glyphs=glyphs})
return font.get('custom')`);
		assert.equal(f.resolve(), undefined, construction);
	}
});

test('unknown metrics, duplicate registrations and arbitrary resolved tables have no guessed projection', () => {
	for (const definition of [
		"{glyphs={['A']='a'},advance_padding=choose_padding()}",
		"{glyphs={['A']='a'},line_height=choose_height()}",
		"{glyphs={['A']='a'},[choose_field()]=2}",
	]) assert.equal(fixture(`local font=require('cartlib/font')
font.define('custom',${definition})
return font.get('custom')`).resolve(), undefined);
	assert.equal(fixture(`local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='first'}})
font.define('custom',{glyphs={['A']='second'}})
return font.get('custom')`).resolve(), undefined);
	assert.equal(fixture("return {items={[65]={id='image'}},advances={[65]=5},line_height=6}").resolve(), undefined);
});

test('callable replacement, competing getter writes and similarly named custom functions revoke font API proof', () => {
	for (const mutation of [
		"font.get=function(id) return {} end",
		"font[choose_key()]=function(id) return {} end",
	]) assert.equal(fixture(`local font=require('cartlib/font')
${mutation}
return font.get('default')`).resolve(), undefined, mutation);
	const replaced = fixture(`local font=require('cartlib/font')
font.define=function(id,definition) end
font.define('default',{glyphs={['A']='guessed'}})
return font.get('default')`);
	assert.equal(replaced.resolve(), undefined);
	assert.equal(replaced.fonts.resolve(replaced.file, null), undefined);
	assert.equal(fixture(`local font={get=function(id) end,define=function(id,definition) end}
font.define('custom',{glyphs={['A']='guessed'}})
return font.get('custom')`).resolve(), undefined);
});

test('implicit default requires the actual catalog getter and preserves the font expression owner across files', () => {
	for (const module of ['', 'return {}', 'return {get=false}', 'return {get=choose_getter()}']) {
		const f = fixture('return nil', [['cartlib/text/font_catalog.lua', module]]);
		assert.equal(f.fonts.resolve(f.file, null), undefined, module);
	}
	const changed = fixture(`local catalog=require('cartlib/text/font_catalog')
catalog.get=function(id) end
return nil`);
	assert.equal(changed.fonts.resolve(changed.file, null), undefined);
	const f = fixture("return require('font_input')", [['font_input.lua', `local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='module_a'}})
return font.get('custom')`]]);
	const owner = f.snapshot.getFileData('font_input.lua')!;
	const expression = owner.moduleValues[0].statement.expressions[0];
	const source = f.snapshot.symbolResolver.writtenSources.expression(owner, expression);
	assert.equal(f.fonts.resolve(f.file, source)!.glyphs.get(65), 'module_a');
});

test('font projections retain their snapshot and steady reads do not traverse registration or glyph sources', t => {
	const source = `local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='before'},line_height=6})
return font.get('custom')`;
	const before = fixture(source), font = before.resolve()!;
	const reads = t.mock.method(before.reader, 'memberState');
	const calls = t.mock.method(before.reader, 'call');
	for (let index = 0; index < 100; index += 1) assert.equal(before.resolve(), font);
	assert.equal(reads.mock.callCount(), 0); assert.equal(calls.mock.callCount(), 0);
	const after = fixture(source.replace('before', 'after'));
	assert.equal(after.resolve()!.glyphs.get(65), 'after'); assert.equal(font.glyphs.get(65), 'before');
});
