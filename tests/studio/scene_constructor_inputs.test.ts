import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { SceneConstructorInputs } from '../../ide/workbench/contrib/scene_editor/constructor_inputs';
import { createPathModuleProjectFixture } from '../helpers/lua_semantic_project';

function fixture() {
	const source = `local defaults=setmetatable({imgid='own',color=nil,font=make_font()},
 {__index={enabled=false,color=0xff123456,imgid='inherited'}})
return {defaults=defaults,class={color=0xffabcdef},input={imgid='instance'}}`;
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture([{ path: 'main.lua', source }]));
	const file = snapshot.getFileData('main.lua')!, reader = new LuaSourceReader(snapshot);
	const root = reader.expression(file, file.moduleValues[0].statement.expressions[0])!;
	const defaults = reader.member(file, root.expression, 'defaults')!, klass = reader.member(file, root.expression, 'class')!;
	const input = reader.member(file, root.expression, 'input')!;
	return { reader, defaults, klass, input };
}

test('captured constructor defaults read copied own storage rather than the original prototype', () => {
	const f = fixture(), inputs = new SceneConstructorInputs(f.reader, null, f.defaults, null);
	assert.equal(inputs.value('enabled'), null); assert.equal(inputs.value('color'), null);
	const image = inputs.value('imgid')!;
	assert.equal(f.reader.stringValue(image.file, image.expression), 'own');
});

test('ordinary configuration retains normal indexing uncertainty instead of becoming a copied default', () => {
	const f = fixture(), inputs = new SceneConstructorInputs(f.reader, f.defaults, null, null);
	assert.equal(inputs.value('enabled'), undefined); assert.equal(inputs.value('color'), undefined);
	const image = inputs.value('imgid')!;
	assert.equal(f.reader.stringValue(image.file, image.expression), 'own');
});

test('instance input precedes copied defaults and nil own storage permits the actual class fallback', () => {
	const f = fixture(), inputs = new SceneConstructorInputs(f.reader, f.input, f.defaults, [f.klass]);
	const image = inputs.value('imgid')!, color = inputs.value('color');
	assert.equal(f.reader.stringValue(image.file, image.expression), 'instance');
	assert.ok(color === f.reader.ownMemberState(f.klass.file, f.klass.expression, 'color'));
});

test('an own captured application retains its actual source even when the original table has a prototype', () => {
	const f = fixture(), inputs = new SceneConstructorInputs(f.reader, null, f.defaults, null), font = inputs.value('font')!;
	assert.equal(font.expression.kind, LuaSyntaxKind.CallExpression);
	assert.ok(f.reader.call(font.file, font.expression)?.expression === font.expression);
});
