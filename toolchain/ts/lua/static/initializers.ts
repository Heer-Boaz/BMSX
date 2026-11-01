import { MemoryAccessKind } from '../../../../machine/ts/spec/blua32/memory_access_kind';
import type { FileSemanticData } from '../semantic/model';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../syntax/ast';
import { StaticSourceError } from './errors';
import type { StaticConstantValue, StaticScalar } from './scalar';
import { indexedStructType, type StructResolvedType } from './struct_types';

export type StaticInitializerScalar = Extract<StaticScalar, { readonly kind: 'number' | 'string' }>;
export type StaticInitializerConstants = {
	evaluate(file: FileSemanticData, expression: LuaExpression): StaticConstantValue | undefined;
	evaluateNumeric(file: FileSemanticData, expression: LuaExpression): number | undefined;
};
export type StaticInitializerVisitor = (byteOffset: number, type: StructResolvedType,
	expression: LuaExpression, value: StaticInitializerScalar) => void;
export type StaticStorageLeafVisitor = (byteOffset: number, type: StructResolvedType, expression: LuaExpression) => void;

/** Validate initializer shape and stream leaves to the owning encoder or source analysis. */
export function visitStaticStorageShape(file: FileSemanticData, type: StructResolvedType, expression: LuaExpression,
	section: '.data' | '.rodata', visit: StaticStorageLeafVisitor, byteOffset = 0): void {
	if (type.dimensions.length !== 0) {
		if (expression.kind !== LuaSyntaxKind.TableConstructorExpression)
			throw new StaticSourceError(`${section} array '${type.name}' requires a table initializer.`, file.file, expression.span);
		const element = indexedStructType(type);
		let index = 0;
		for (const field of expression.fields) {
			if (field.kind !== LuaTableFieldKind.Array)
				throw new StaticSourceError(`${section} arrays use positional initializers.`, file.file, field.span);
			visitStaticStorageShape(file, element, field.value, section, visit, byteOffset + index * element.size);
			index++;
		}
		if (index !== type.dimensions[0])
			throw new StaticSourceError(`${section} array '${type.name}' expects ${type.dimensions[0]} elements.`, file.file, expression.span);
		return;
	}
	if (type.struct !== null) {
		if (expression.kind !== LuaSyntaxKind.TableConstructorExpression)
			throw new StaticSourceError(`${section} struct '${type.name}' requires a named-field initializer.`, file.file, expression.span);
		const initialized = new Set<string>();
		for (const field of expression.fields) {
			if (field.kind !== LuaTableFieldKind.IdentifierKey)
				throw new StaticSourceError(`${section} struct '${type.name}' uses named-field initializers.`, file.file, field.span);
			const layout = type.struct.fields.get(field.name);
			if (layout === undefined)
				throw new StaticSourceError(`${section} initializer has no field '${field.name}' in struct '${type.name}'.`, file.file, field.span);
			if (initialized.has(field.name))
				throw new StaticSourceError(`${section} initializer repeats field '${field.name}' in struct '${type.name}'.`, file.file, field.span);
			initialized.add(field.name);
			visitStaticStorageShape(file, layout.type, field.value, section, visit, byteOffset + layout.offset);
		}
		for (const field of type.struct.fields.values()) if (!initialized.has(field.name))
			throw new StaticSourceError(`${section} initializer is missing field '${field.name}' in struct '${type.name}'.`, file.file, expression.span);
		return;
	}
	visit(byteOffset, type, expression);
}

/** Prove source scalar values without materializing an encoded image. */
export function visitStaticStorageInitializer(file: FileSemanticData, type: StructResolvedType, expression: LuaExpression,
	section: '.data' | '.rodata', constants: StaticInitializerConstants, visit: StaticInitializerVisitor): void {
	visitStaticStorageShape(file, type, expression, section, (byteOffset, scalar, initializer) => {
		const access = scalar.access!;
		if (access.kind === 'const_pool' && section !== '.rodata')
			throw new StaticSourceError('Static string fields are only valid in .rodata storage.', file.file, initializer.span);
		if (access.kind === 'const_pool') {
			const value = constants.evaluate(file, initializer);
			if (value?.kind !== 'string')
				throw new StaticSourceError('.rodata string initializer must be a compile-time string.', file.file, initializer.span);
			visit(byteOffset, scalar, initializer, value);
			return;
		}
		const number = constants.evaluateNumeric(file, initializer);
		if (number === undefined)
			throw new StaticSourceError(`${section} primitive initializer must be a compile-time number.`, file.file, initializer.span);
		if (access.memoryKind !== MemoryAccessKind.F32LE && access.memoryKind !== MemoryAccessKind.F64LE && !Number.isInteger(number))
			throw new StaticSourceError(`${section} primitive initializer must be a compile-time integer.`, file.file, initializer.span);
		visit(byteOffset, scalar, initializer, { kind: 'number', value: number });
	});
}
