import { MemoryAccessKind } from '../../../../machine/ts/spec/blua32/memory_access_kind';
import { LuaSyntaxKind, type LuaOffsetOfExpression, type LuaTypeReference } from '../syntax/ast';
import type { LuaSyntaxSpan } from '../syntax/source_locations';
import type { Decl, FileSemanticData, LuaSemanticWorkspaceSnapshot, SymbolID } from '../semantic/model';
import { StaticConstants, type StaticBindings } from './constants';
import { StaticSourceError } from './errors';

export type StructScalarAccess =
	| { kind: 'memory'; memoryKind: MemoryAccessKind }
	| { kind: 'const_pool' };

type PrimitiveStructType = { size: number; alignment: number; access: StructScalarAccess };

export type StructResolvedType = {
	name: string;
	baseSize: number;
	baseAlignment: number;
	baseAccess: StructScalarAccess | null;
	baseStruct: StructLayout | null;
	size: number;
	alignment: number;
	access: StructScalarAccess | null;
	struct: StructLayout | null;
	dimensions: readonly number[];
};

type StructFieldLayout = {
	name: string;
	type: StructResolvedType;
	offset: number;
	size: number;
	access: StructScalarAccess | null;
};

export type StructLayout = {
	declaration: Decl;
	name: string;
	size: number;
	alignment: number;
	fields: ReadonlyMap<string, StructFieldLayout>;
};

const PRIMITIVE_STRUCT_TYPES: ReadonlyMap<string, PrimitiveStructType> = new Map([
	['u8', { size: 1, alignment: 1, access: { kind: 'memory', memoryKind: MemoryAccessKind.U8 } }],
	['i8', { size: 1, alignment: 1, access: { kind: 'memory', memoryKind: MemoryAccessKind.U8 } }],
	['u16', { size: 2, alignment: 2, access: { kind: 'memory', memoryKind: MemoryAccessKind.U16LE } }],
	['i16', { size: 2, alignment: 2, access: { kind: 'memory', memoryKind: MemoryAccessKind.U16LE } }],
	['u32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['i32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['f32', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.F32LE } }],
	['f64', { size: 8, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.F64LE } }],
	['addr', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.U32LE } }],
	['word', { size: 4, alignment: 4, access: { kind: 'memory', memoryKind: MemoryAccessKind.Word } }],
	['string', { size: 4, alignment: 4, access: { kind: 'const_pool' } }],
]);

function makeStructResolvedType(name: string, baseSize: number, baseAlignment: number, baseAccess: StructScalarAccess | null,
	baseStruct: StructLayout | null, dimensions: readonly number[]): StructResolvedType {
	let size = baseSize;
	for (const dimension of dimensions) size *= dimension;
	const isElement = dimensions.length === 0;
	return { name, baseSize, baseAlignment, baseAccess, baseStruct, size, alignment: baseAlignment,
		access: isElement ? baseAccess : null, struct: isElement ? baseStruct : null, dimensions };
}

export function indexedStructType(type: StructResolvedType): StructResolvedType {
	if (type.dimensions.length === 0) throw new Error(`Type '${type.name}' is not an array.`);
	return makeStructResolvedType(type.name, type.baseSize, type.baseAlignment, type.baseAccess, type.baseStruct, type.dimensions.slice(1));
}

/** Source layouts depend on declarations/constants, never on active codegen registers. */
export class StructTypes {
	private readonly layouts = new Map<SymbolID, StructLayout>();
	private readonly storageTypes = new Map<SymbolID, StructResolvedType>();
	private readonly resolving = new Set<SymbolID>();
	public readonly constants: StaticConstants;

	public constructor(private readonly snapshot: LuaSemanticWorkspaceSnapshot, bindings: StaticBindings) {
		this.constants = new StaticConstants(snapshot, this, bindings);
	}

	public resolve(path: string, typeRef: LuaTypeReference, inferredOuterLength?: number): StructResolvedType {
		const file = this.snapshot.getFileData(path)!;
		const primitive = PRIMITIVE_STRUCT_TYPES.get(typeRef.name);
		const layout = primitive === undefined ? this.layout(file, typeRef.name, typeRef.span) : null;
		const dimensions: number[] = [];
		for (let index = 0; index < typeRef.arrayLengths.length; index++) {
			const expression = typeRef.arrayLengths[index];
			if (expression === null) {
				if (index !== 0 || inferredOuterLength === undefined) {
					throw new StaticSourceError('An inferred array length is only valid for the outer dimension of an initialized .data or .rodata declaration.', path, typeRef.span);
				}
				dimensions.push(inferredOuterLength);
			} else {
				const value = this.constants.evaluate(file, expression);
				if (value?.kind !== 'number' || !Number.isInteger(value.value) || value.value <= 0) {
					throw new StaticSourceError('Struct array length must be a positive compile-time integer.', path, expression.span);
				}
				dimensions.push(value.value);
			}
		}
		return makeStructResolvedType(typeRef.name, primitive === undefined ? layout!.size : primitive.size,
			primitive === undefined ? layout!.alignment : primitive.alignment, primitive === undefined ? null : primitive.access, layout, dimensions);
	}

	public storage(declaration: Decl): StructResolvedType {
		const retained = this.storageTypes.get(declaration.id);
		if (retained !== undefined) return retained;
		if (this.resolving.has(declaration.id)) throw new StaticSourceError(`Recursive static storage type '${declaration.name}' is not supported.`, declaration.file, declaration.span);
		this.resolving.add(declaration.id);
		try {
			const statement = this.snapshot.symbolResolver.staticDeclarations.storage(declaration);
			let count: number | undefined;
			if (statement.typeRef.arrayLengths[0] === null && statement.kind !== LuaSyntaxKind.BssDeclarationStatement) {
				const section = statement.kind === LuaSyntaxKind.DataDeclarationStatement ? '.data' : '.rodata';
				if (statement.initializer.kind !== LuaSyntaxKind.TableConstructorExpression) {
					throw new StaticSourceError(`${section} inferred array storage requires a table initializer.`, declaration.file, statement.initializer.span);
				}
				count = statement.initializer.fields.length;
				if (count === 0) throw new StaticSourceError(`${section} inferred array storage requires at least one element.`, declaration.file, statement.initializer.span);
			}
			const type = this.resolve(declaration.file, statement.typeRef, count);
			this.storageTypes.set(declaration.id, type);
			return type;
		} finally {
			this.resolving.delete(declaration.id);
		}
	}

	public offsetOf(path: string, expression: LuaOffsetOfExpression): number {
		let layout = this.layout(this.snapshot.getFileData(path)!, expression.typeName, expression.span);
		let offset = 0;
		for (let index = 0; index < expression.fieldPath.length; index++) {
			const name = expression.fieldPath[index];
			const field = layout.fields.get(name);
			if (field === undefined) throw new StaticSourceError(`Unknown field '${name}' on struct '${layout.name}'.`, path, expression.span);
			offset += field.offset;
			if (index + 1 < expression.fieldPath.length) {
				if (field.type.struct === null) {
					throw new StaticSourceError(`offsetof cannot select '${expression.fieldPath[index + 1]}' through non-struct type '${field.type.name}'.`, path, expression.span);
				}
				layout = field.type.struct;
			}
		}
		return offset;
	}

	private layout(file: FileSemanticData, name: string, span: LuaSyntaxSpan): StructLayout {
		const declarations = this.snapshot.symbolResolver.staticDeclarations;
		const declaration = declarations.typeAt(file, name, span);
		if (declaration === undefined) throw new StaticSourceError(`Unknown struct type '${name}'.`, file.file, span);
		const retained = this.layouts.get(declaration.id);
		if (retained !== undefined) return retained;
		if (this.resolving.has(declaration.id)) throw new StaticSourceError(`Recursive struct layout '${name}' is not supported.`, file.file, span);
		this.resolving.add(declaration.id);
		try {
			let offset = 0, alignment = 1;
			const fields = new Map<string, StructFieldLayout>();
			for (const field of declarations.struct(declaration).fields) {
				if (fields.has(field.name)) throw new StaticSourceError(`Duplicate field '${field.name}' in struct '${name}'.`, declaration.file, field.span);
				const type = this.resolve(declaration.file, field.typeRef);
				offset = (offset + type.alignment - 1) & ~(type.alignment - 1);
				fields.set(field.name, { name: field.name, type, offset, size: type.size, access: type.access });
				offset += type.size;
				alignment = Math.max(alignment, type.alignment);
			}
			const layout: StructLayout = { declaration, name, size: (offset + alignment - 1) & ~(alignment - 1), alignment, fields };
			this.layouts.set(declaration.id, layout);
			return layout;
		} finally {
			this.resolving.delete(declaration.id);
		}
	}
}
