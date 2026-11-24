import { MAX_EXT_REGISTER_BC } from '../../../../machine/ts/spec/blua32/instruction_format';
import { numberConstantInteger } from '../number';
import type { LuaSemanticFrontendFile } from '../semantic/frontend';
import type { SymbolID } from '../semantic/model';
import {
	LuaAssignmentOperator,
	LuaMemberOperator,
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../syntax/ast';
import { walkLuaAst, type LuaAstNode } from '../syntax/ast/traversal';
import { getBoundDeclaration, getBoundIdentifierReference } from './bound_reference';

type TableShape = { array: number; hash: number };
export type TableShapes = Map<LuaTableConstructorExpression, TableShape>;

type PredictedLocal = {
	constructor: LuaTableConstructorExpression;
	array: number;
	fields?: Set<string>;
};

function tableInitializer(value: LuaExpression, semantics: LuaSemanticFrontendFile): LuaTableConstructorExpression | undefined {
	if (value.kind === LuaSyntaxKind.CallExpression && value.method === null && value.arguments.length === 2
		&& value.callee.kind === LuaSyntaxKind.IdentifierExpression && value.callee.name === 'setmetatable'
		&& getBoundIdentifierReference(semantics, value.callee).kind === 'global') {
		value = value.arguments[0];
	}
	if (value.kind === LuaSyntaxKind.TableConstructorExpression && value.fields.length === 0) return value;
}

// Like Luau's table-shape pass, size the allocation from direct writes to
// its source local. The writes stay in place: aliases, right-hand effects
// and __newindex are not part of the prediction.
export function predictTableShapes(chunk: LuaChunk, semantics: LuaSemanticFrontendFile, shapes: TableShapes): void {
	function visitFunction(body: LuaAstNode): void {
		let locals: Map<SymbolID, PredictedLocal> | undefined;
		walkLuaAst(body, node => {
			switch (node.kind) {
				case LuaSyntaxKind.FunctionExpression:
					visitFunction(node.body);
					return false;
				case LuaSyntaxKind.LocalAssignmentStatement: {
					if (node.names.length !== 1 || node.values.length !== 1) break;
					const constructor = tableInitializer(node.values[0], semantics);
					if (constructor === undefined) break;
					const decl = getBoundDeclaration(semantics, node.names[0]);
					if (semantics.declarationValuesByDeclaration.get(decl.id)?.length !== 1) break;
					(locals ??= new Map()).set(decl.id, { constructor, array: 0 });
					break;
				}
				case LuaSyntaxKind.AssignmentStatement:
					if (locals === undefined || node.operator !== LuaAssignmentOperator.Assign) break;
					for (let i = 0; i < node.left.length; ++i) {
						const target = node.left[i];
						if ((target.kind !== LuaSyntaxKind.MemberExpression && target.kind !== LuaSyntaxKind.IndexExpression)
							|| target.base.kind !== LuaSyntaxKind.IdentifierExpression
							|| node.right[i]?.kind === LuaSyntaxKind.NilLiteralExpression) continue;
						const ref = getBoundIdentifierReference(semantics, target.base);
						const shape = ref.kind === 'lexical' ? locals.get(ref.decl.id) : undefined;
						if (shape === undefined) continue;
						if (target.kind === LuaSyntaxKind.MemberExpression) {
							if (target.operator === LuaMemberOperator.Dot && target.member.kind === LuaSyntaxKind.IdentifierExpression) {
								(shape.fields ??= new Set()).add(target.member.name);
							}
						} else if (target.index.kind === LuaSyntaxKind.StringLiteralExpression) {
							(shape.fields ??= new Set()).add(target.index.value);
						} else if (target.index.kind === LuaSyntaxKind.NumericLiteralExpression
							&& numberConstantInteger(target.index.value) === shape.array + 1) {
							++shape.array;
						}
					}
					break;
			}
		});
		if (locals === undefined) return;
		for (const { constructor, array, fields } of locals.values()) {
			const hash = fields === undefined ? 0 : fields.size;
			if (array !== 0 || hash !== 0) {
				shapes.set(constructor, { array: Math.min(array, MAX_EXT_REGISTER_BC), hash: Math.min(hash, MAX_EXT_REGISTER_BC) });
			}
		}
	}
	visitFunction(chunk);
}
