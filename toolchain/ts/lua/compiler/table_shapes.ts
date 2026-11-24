import { MAX_EXT_REGISTER_BC, MAX_FIELD_EXTRA_HASH_SLOTS } from '../../../../machine/ts/spec/blua32/instruction_format';
import { numberConstantInteger } from '../number';
import type { LuaSemanticFrontendFile } from '../semantic/frontend';
import type { SymbolID } from '../semantic/model';
import {
	LuaAssignmentOperator,
	LuaMemberOperator,
	LuaSyntaxKind,
	type LuaAssignmentStatement,
	type LuaBlock,
	type LuaChunk,
	type LuaExpression,
	type LuaTableConstructorExpression,
} from '../syntax/ast';
import { walkLuaAst, type LuaAstNode } from '../syntax/ast/traversal';
import { getBoundDeclaration, getBoundIdentifierReference } from './bound_reference';

type TableShape = { array: number; hash: number };
export type TableShapes = {
	fresh: Map<LuaTableConstructorExpression, TableShape>;
	growth: Map<LuaAssignmentStatement, number>;
};

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

function isGrowthRunValue(value: LuaExpression): boolean {
	if (value.kind === LuaSyntaxKind.NilLiteralExpression) return false;
	let local = true;
	walkLuaAst(value, node => {
		if (node.kind === LuaSyntaxKind.CallExpression || node.kind === LuaSyntaxKind.FunctionExpression
			|| node.kind === LuaSyntaxKind.TableConstructorExpression) local = false;
		if (!local) return false;
	});
	return local;
}

// The factory can be a dynamic call. Use only the local, contiguous field
// writes of a returned builder value, never a presumed allocation or callee.
// RHS expressions still run normally; the request is extra capacity, not a
// proof that those stores insert new keys (or that they all complete).
function predictReturnedTableGrowth(body: LuaBlock, semantics: LuaSemanticFrontendFile, growth: TableShapes['growth']): void {
	if (body.body.length < 3) return;
	const ret = body.body.get(body.body.length - 1);
	if (ret.kind !== LuaSyntaxKind.ReturnStatement) return;
	const first = ret.expressions[0];
	if (first?.kind !== LuaSyntaxKind.IdentifierExpression) return;
	const ref = getBoundIdentifierReference(semantics, first);
	if (ref.kind !== 'lexical') return;
	const run: { statement: LuaAssignmentStatement; key: string }[] = [];
	let boundFromCall = false;
	for (const statement of body.body) {
		if (!boundFromCall) {
			boundFromCall = statement.kind === LuaSyntaxKind.LocalAssignmentStatement
				&& statement.attributes[0] === 'const' && statement.values[0]?.kind === LuaSyntaxKind.CallExpression
				&& getBoundDeclaration(semantics, statement.names[0]).id === ref.decl.id;
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement && statement.operator === LuaAssignmentOperator.Assign
			&& statement.left.length === 1 && statement.right.length === 1
			&& isGrowthRunValue(statement.right[0])) {
			const target = statement.left[0];
			if ((target.kind === LuaSyntaxKind.MemberExpression || target.kind === LuaSyntaxKind.IndexExpression)
				&& target.base.kind === LuaSyntaxKind.IdentifierExpression) {
				const base = getBoundIdentifierReference(semantics, target.base);
				const key = target.kind === LuaSyntaxKind.MemberExpression
					? target.operator === LuaMemberOperator.Dot && target.member.kind === LuaSyntaxKind.IdentifierExpression
						? target.member.name : undefined
					: target.index.kind === LuaSyntaxKind.StringLiteralExpression ? target.index.value : undefined;
				if (key !== undefined && base.kind === 'lexical' && base.decl.id === ref.decl.id) {
					run.push({ statement, key });
					continue;
				}
			}
		}
		if (run.length > 1) {
			const suffix = new Set<string>();
			for (let i = run.length - 1; i >= 0; --i) {
				const { statement: write, key } = run[i];
				const count = suffix.size - (suffix.has(key) ? 1 : 0);
				if (count !== 0) growth.set(write, Math.min(count, MAX_FIELD_EXTRA_HASH_SLOTS));
				suffix.add(key);
			}
		}
		run.length = 0;
	}
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
					predictReturnedTableGrowth(node.body, semantics, shapes.growth);
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
				shapes.fresh.set(constructor, { array: Math.min(array, MAX_EXT_REGISTER_BC), hash: Math.min(hash, MAX_EXT_REGISTER_BC) });
			}
		}
	}
	visitFunction(chunk);
}
