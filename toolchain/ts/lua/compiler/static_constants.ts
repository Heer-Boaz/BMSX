import { utf8CodepointCount } from '../../../../machine/ts/common/utf8';
import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator, type LuaExpression } from '../syntax/ast';
import type { LuaSemanticFrontend } from '../semantic/frontend';
import type { Decl, FileSemanticData, SymbolID } from '../semantic/model';
import { getLuaModuleAliasTarget } from '../semantic/module_bindings';
import { readLuaExpressionSource } from '../semantic/value_graph';
import { writtenSourceExpression } from '../semantic/written_sources';
import { buildModuleExportPathKey } from '../module_path';
import { evaluateCompileTimeNumberBinaryOperator } from './compile_time_number';
import type { ConstExportValue, ModuleCompileContext } from './passes/module_contract';
import type { StructTypes } from './struct_types';

/** Static type dimensions read immutable initializers, not a consumer's local slots. */
export class StaticConstants {
	private readonly values = new Map<SymbolID, ConstExportValue | undefined>();
	private readonly resolving = new Set<SymbolID>();

	public constructor(private readonly frontend: LuaSemanticFrontend, private readonly modules: ModuleCompileContext,
		private readonly types: StructTypes) {}

	public evaluate(file: FileSemanticData, expression: LuaExpression): ConstExportValue | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression: return { kind: 'number', value: expression.value };
			case LuaSyntaxKind.StringLiteralExpression: return { kind: 'string', value: expression.value };
			case LuaSyntaxKind.BooleanLiteralExpression: return { kind: 'boolean', value: expression.value };
			case LuaSyntaxKind.NilLiteralExpression: return { kind: 'nil' };
			case LuaSyntaxKind.IdentifierExpression: {
				const resolver = this.frontend.snapshot.symbolResolver;
				const target = resolver.resolveReference(file.referencesBySyntax.get(expression)!);
				if (target === undefined) return undefined;
				const declaration = resolver.getDeclaration(target);
				if (declaration.kind !== 'constant') return undefined;
				return this.constant(declaration);
			}
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression:
				return this.moduleExport(file, expression);
			case LuaSyntaxKind.SizeOfExpression:
				return { kind: 'number', value: this.types.resolve(file.file, expression.typeRef).size };
			case LuaSyntaxKind.OffsetOfExpression:
				return { kind: 'number', value: this.types.offsetOf(file.file, expression) };
			case LuaSyntaxKind.UnaryExpression: {
				if (expression.operator === LuaUnaryOperator.Length) {
					const count = this.storageLength(file, expression.operand);
					if (count !== undefined) return { kind: 'number', value: count };
				}
				const operand = this.evaluate(file, expression.operand);
				if (operand === undefined) return undefined;
				switch (expression.operator) {
					case LuaUnaryOperator.Negate:
						return operand.kind === 'number' ? { kind: 'number', value: -operand.value } : undefined;
					case LuaUnaryOperator.BitwiseNot:
						return operand.kind === 'number' ? { kind: 'number', value: ~operand.value } : undefined;
					case LuaUnaryOperator.Not:
						return { kind: 'boolean', value: operand.kind === 'nil' || operand.kind === 'boolean' && !operand.value };
					case LuaUnaryOperator.Length:
						return operand.kind === 'string' ? { kind: 'number', value: utf8CodepointCount(operand.value) } : undefined;
					case LuaUnaryOperator.StringId:
						return operand.kind === 'string' ? operand : undefined;
					default: return undefined;
				}
			}
			case LuaSyntaxKind.BinaryExpression: {
				const left = this.evaluate(file, expression.left);
				if (left === undefined) return undefined;
				const falsey = left.kind === 'nil' || left.kind === 'boolean' && !left.value;
				if (expression.operator === LuaBinaryOperator.And) return falsey ? left : this.evaluate(file, expression.right);
				if (expression.operator === LuaBinaryOperator.Or) return falsey ? this.evaluate(file, expression.right) : left;
				const right = this.evaluate(file, expression.right);
				if (right === undefined) return undefined;
				if (expression.operator === LuaBinaryOperator.Equal || expression.operator === LuaBinaryOperator.NotEqual) {
					// Relocations become numbers at link time; their tags are not literal values.
					if (right.kind === 'bss_addr' || right.kind === 'data_addr' || right.kind === 'rodata_addr' || right.kind === 'link_value') {
						return undefined;
					}
					let equal: boolean;
					switch (left.kind) {
						case 'nil': equal = right.kind === 'nil'; break;
						case 'boolean': equal = right.kind === 'boolean' && left.value === right.value; break;
						case 'number': equal = right.kind === 'number' && left.value === right.value; break;
						case 'string': equal = right.kind === 'string' && left.value === right.value; break;
						default: return undefined;
					}
					return { kind: 'boolean', value: expression.operator === LuaBinaryOperator.Equal ? equal : !equal };
				}
				if (expression.operator === LuaBinaryOperator.Concat) {
					return (left.kind === 'number' || left.kind === 'string') && (right.kind === 'number' || right.kind === 'string')
						? { kind: 'string', value: String(left.value) + String(right.value) } : undefined;
				}
				if (left.kind === 'number' && right.kind === 'number' || left.kind === 'string' && right.kind === 'string') {
					switch (expression.operator) {
						case LuaBinaryOperator.LessThan: return { kind: 'boolean', value: left.value < right.value };
						case LuaBinaryOperator.LessEqual: return { kind: 'boolean', value: left.value <= right.value };
						case LuaBinaryOperator.GreaterThan: return { kind: 'boolean', value: left.value > right.value };
						case LuaBinaryOperator.GreaterEqual: return { kind: 'boolean', value: left.value >= right.value };
					}
				}
				if (left.kind !== 'number' || right.kind !== 'number') return undefined;
				const value = evaluateCompileTimeNumberBinaryOperator(expression.operator, left.value, right.value);
				return value === undefined ? undefined : { kind: 'number', value };
			}
			default: return undefined;
		}
	}

	private constant(declaration: Decl): ConstExportValue | undefined {
		if (this.values.has(declaration.id)) return this.values.get(declaration.id);
		if (this.resolving.has(declaration.id)) throw new Error(`Recursive compile-time constant '${declaration.name}' is not supported.`);
		this.resolving.add(declaration.id);
		const file = this.frontend.snapshot.getFileData(declaration.file)!;
		const write = file.declarationValuesByDeclaration.get(declaration.id)![0];
		const expression = writtenSourceExpression(this.frontend.snapshot.symbolResolver.writtenSources.write(write));
		const value = expression === undefined ? undefined : this.evaluate(file, expression);
		this.values.set(declaration.id, value);
		this.resolving.delete(declaration.id);
		return value;
	}

	private moduleExport(file: FileSemanticData, expression: LuaExpression): ConstExportValue | undefined {
		const target = getLuaModuleAliasTarget(file, readLuaExpressionSource(file, expression));
		if (target === null || target.memberPath.length === 0) return undefined;
		const path = this.frontend.moduleTargetsByAlias.get(target.module);
		if (path === undefined) return undefined;
		const module = this.modules.modulesByPath.get(path);
		return module?.constModule ? module.exportConstValueByPathKey.get(buildModuleExportPathKey(target.memberPath)) : undefined;
	}

	private storageLength(file: FileSemanticData, expression: LuaExpression): number | undefined {
		const resolver = this.frontend.snapshot.symbolResolver;
		let declaration: Decl;
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const target = resolver.resolveReference(file.referencesBySyntax.get(expression)!);
			if (target === undefined) return undefined;
			declaration = resolver.getDeclaration(target);
			if (declaration.kind !== 'bss' && declaration.kind !== 'data' && declaration.kind !== 'rodata') return undefined;
		} else if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
			const value = this.moduleExport(file, expression);
			if (value?.kind !== 'bss_addr' && value?.kind !== 'data_addr' && value?.kind !== 'rodata_addr') return undefined;
			declaration = resolver.getDeclaration(value.symbolHandle);
		} else {
			return undefined;
		}
		return this.types.storage(declaration).dimensions[0];
	}
}
