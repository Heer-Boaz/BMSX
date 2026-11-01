import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator, type LuaExpression } from '../syntax/ast';
import type { Decl, FileSemanticData, LuaSemanticWorkspaceSnapshot, SymbolID } from '../semantic/model';
import { writtenSourceExpression } from '../semantic/written_sources';
import { StaticSourceError } from './errors';
import { utf8CodepointCount } from '../../../../machine/ts/common/utf8';
import { evaluateStaticNumeric, type StaticNumericContext, type StaticNumericValue } from './numeric';
import {
	evaluateStaticBinaryOperator,
	evaluateStaticUnaryOperator,
	isStaticFalsey,
	type StaticConstantValue,
} from './scalar';
import type { StructTypes } from './struct_types';
import type { LuaIdentifierExpression, LuaIndexExpression, LuaMemberExpression, LuaOffsetOfExpression, LuaSizeOfExpression } from '../syntax/ast';

/** The producer decides which external values and storage identities are static. */
export type StaticBindings = {
	value(file: FileSemanticData, expression: LuaExpression): StaticConstantValue | undefined;
	storage(file: FileSemanticData, expression: LuaExpression): Decl | undefined;
};

/** Static type dimensions read immutable initializers, not a consumer's local slots. */
export class StaticConstants implements StaticNumericContext<FileSemanticData, Extract<StaticConstantValue, { kind: 'link_value' }>> {
	private readonly values = new Map<SymbolID, StaticConstantValue | undefined>();
	private readonly resolving = new Set<SymbolID>();

	public constructor(private readonly snapshot: LuaSemanticWorkspaceSnapshot, private readonly types: StructTypes,
		private readonly bindings: StaticBindings) {}

	public evaluate(file: FileSemanticData, expression: LuaExpression): StaticConstantValue | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression: return { kind: 'number', value: expression.value };
			case LuaSyntaxKind.StringLiteralExpression: return { kind: 'string', value: expression.value };
			case LuaSyntaxKind.BooleanLiteralExpression: return { kind: 'boolean', value: expression.value };
			case LuaSyntaxKind.NilLiteralExpression: return { kind: 'nil' };
			case LuaSyntaxKind.IdentifierExpression: {
				const resolver = this.snapshot.symbolResolver;
				const target = file.referencesBySyntax.get(expression)!.target;
				if (target === undefined) return undefined;
				const declaration = resolver.getDeclaration(target);
				if (declaration.kind !== 'constant') return undefined;
				return this.constant(declaration);
			}
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression:
				return this.bindings.value(file, expression);
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
				return operand === undefined ? undefined : evaluateStaticUnaryOperator(expression.operator, operand);
			}
			case LuaSyntaxKind.BinaryExpression: {
				const left = this.evaluate(file, expression.left);
				if (left === undefined) return undefined;
				const falsey = isStaticFalsey(left);
				if (expression.operator === LuaBinaryOperator.And) return falsey ? left : this.evaluate(file, expression.right);
				if (expression.operator === LuaBinaryOperator.Or) return falsey ? this.evaluate(file, expression.right) : left;
				const right = this.evaluate(file, expression.right);
				return right === undefined ? undefined : evaluateStaticBinaryOperator(expression.operator, left, right);
			}
			default: return undefined;
		}
	}

	/** Numeric initializer admission is narrower than general constant folding. */
	public evaluateNumeric(file: FileSemanticData, expression: LuaExpression): number | undefined {
		const value = evaluateStaticNumeric(this, file, expression);
		return value?.kind === 'number' ? value.value : undefined;
	}

	public resolveNumeric(file: FileSemanticData, expression: LuaIdentifierExpression | LuaMemberExpression | LuaIndexExpression):
		StaticNumericValue<Extract<StaticConstantValue, { kind: 'link_value' }>> | undefined {
		const value = this.evaluate(file, expression);
		return value?.kind === 'number' || value?.kind === 'link_value' ? value : undefined;
	}
	public numericLength(file: FileSemanticData, expression: LuaExpression): number | undefined {
		const count = this.storageLength(file, expression);
		if (count !== undefined) return count;
		const value = this.evaluate(file, expression);
		return value?.kind === 'string' ? utf8CodepointCount(value.value) : undefined;
	}
	public numericSize(file: FileSemanticData, expression: LuaSizeOfExpression): number {
		return this.types.resolve(file.file, expression.typeRef).size;
	}
	public numericOffset(file: FileSemanticData, expression: LuaOffsetOfExpression): number {
		return this.types.offsetOf(file.file, expression);
	}
	public numericLinkUnary(): undefined { return undefined; }
	public numericLinkBinary(): undefined { return undefined; }


	private constant(declaration: Decl): StaticConstantValue | undefined {
		if (this.values.has(declaration.id)) return this.values.get(declaration.id);
		if (this.resolving.has(declaration.id)) {
			throw new StaticSourceError(`Recursive compile-time constant '${declaration.name}' is not supported.`, declaration.file, declaration.span);
		}
		this.resolving.add(declaration.id);
		try {
			const file = this.snapshot.getFileData(declaration.file)!;
			const write = file.declarationValuesByDeclaration.get(declaration.id)![0];
			const expression = writtenSourceExpression(this.snapshot.symbolResolver.writtenSources.write(write));
			const value = expression === undefined ? undefined : this.evaluate(file, expression);
			this.values.set(declaration.id, value);
			return value;
		} finally {
			this.resolving.delete(declaration.id);
		}
	}

	private storageLength(file: FileSemanticData, expression: LuaExpression): number | undefined {
		const resolver = this.snapshot.symbolResolver;
		let declaration: Decl;
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const target = file.referencesBySyntax.get(expression)!.target;
			if (target === undefined) return undefined;
			declaration = resolver.getDeclaration(target);
			if (declaration.kind !== 'bss' && declaration.kind !== 'data' && declaration.kind !== 'rodata') return undefined;
		} else if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
			const storage = this.bindings.storage(file, expression);
			if (storage === undefined) return undefined;
			declaration = storage;
		} else {
			return undefined;
		}
		return this.types.storage(declaration).dimensions[0];
	}
}
