import assert from 'node:assert/strict';
import { test } from 'node:test';
import { luaLiteralSource, prepareLuaArguments, prepareLuaLiteral } from '../../ide/runtime/lua_literal';
import { valueBool, valueFloat, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';

test('literal submission prepares only values and canonical Lua source without executing input', () => {
	const prepared = prepareLuaLiteral('{ flag = false, nested = { 7, -2.5 }, [4] = "event\\x00\\xff" }');
	assert.equal(luaLiteralSource(prepared), "{['flag']=false,['nested']={7,-2.5},[4]='event\\x00\\xff'}");
	for (const text of ['', '1, 2', 'world:spawn("actor")', 'function() end', '1; print(2)', '{ value = actor }', '{ [nil] = 1 }']) {
		assert.throws(() => prepareLuaLiteral(text));
	}
});

test('literal submission keeps exactly the compiler Integer/Float words, including wrapped and negated literals', () => {
	const text = 'nil, false, 16777217, 2.0, -0.0, -2147483648, 0xffffffff, -0xffffffff, 0x1p-149, 1e30';
	const expected = [valueNil(), valueBool(false), valueInteger(16777217), valueFloat(2), valueFloatBits(0x80000000), valueFloat(-2147483648),
		valueInteger(-1), valueInteger(1), valueFloatBits(1), valueFloat(1e30)];
	const actual = prepareLuaArguments(text).map(literal => {
		assert.equal(literal.kind, 'scalar');
		return literal.value;
	});
	assert.deepEqual(actual, expected);
	assert.throws(() => prepareLuaLiteral('1e40'), /not finite/);
});
