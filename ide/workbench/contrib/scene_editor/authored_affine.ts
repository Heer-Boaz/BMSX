import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceReader } from '../../../language/lua/source_reader';
import type { SceneSourceAffine } from './model';

/** The shared authored full-affine representation, never a TRS guess or evaluator. */
export function readSceneSourceAffine(reader: LuaSourceReader, file: FileSemanticData, value: LuaExpression): SceneSourceAffine | undefined {
	const source = reader.expression(file, value), expression = source?.expression;
	if (expression?.kind !== LuaSyntaxKind.TableConstructorExpression || reader.snapshot.symbolResolver.authoredSources.tableMutations().has(expression)
		|| expression.fields.length !== 6 && expression.fields.length !== 12) return;
	const values: number[] = [];
	for (const field of expression.fields) {
		if (field.kind !== LuaTableFieldKind.Array) return;
		let value = readLuaNumberExpression(field.value);
		if (value === null) { const resolved = reader.expression(source.file, field.value)?.expression; value = resolved === undefined ? null : readLuaNumberExpression(resolved); }
		if (value === null) return; values.push(value);
	}
	return values.length === 6 ? { family: '2d', xx: values[0], xy: values[1], yx: values[2], yy: values[3], ox: values[4], oy: values[5] }
		: { family: '3d', xx: values[0], xy: values[1], xz: values[2], yx: values[3], yy: values[4], yz: values[5], zx: values[6], zy: values[7], zz: values[8], ox: values[9], oy: values[10], oz: values[11] };
}
