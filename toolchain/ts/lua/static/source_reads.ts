import { LuaBinaryOperator, LuaSyntaxKind, LuaUnaryOperator, type LuaExpression } from '../syntax/ast';
import { LuaCompletionAnalysis, type LuaSourceControlFlow } from '../analysis/completion';
import type { LuaStatementSequence } from '../syntax/statement_sequence';
import type { Decl, FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../semantic/model';
import { getLuaModuleAliasTarget } from '../semantic/module_bindings';
import { buildModuleExportPathKey } from '../module_path';
import { readLuaExpressionSource } from '../semantic/value_graph';
import { writtenSourceExpression, type LuaWrittenSource } from '../semantic/written_sources';
import type { LuaAuthoredSourceTrace } from '../semantic/authored_sources';
import { StaticSourceError } from './errors';
import { visitStaticStorageInitializer, type StaticInitializerScalar } from './initializers';
import { evaluateStaticBinaryOperator, evaluateStaticUnaryOperator, isStaticFalsey, type StaticConstantValue, type StaticScalar } from './scalar';
import { indexedStructType, StructTypes, type StructResolvedType } from './struct_types';

// Every u32 base plus a displacement in this interval is an exact binary64
// integer. Keep the signed displacement until the final address boundary so
// that each authored addition remains provable before applying word wrapping.
const MIN_EXACT_ADDRESS_DISPLACEMENT = -0x20000000000000;
const MAX_EXACT_ADDRESS_DISPLACEMENT = 0x1fffff00000001;

function exactAddressDisplacement(base: number | undefined, displacement: number): number | undefined {
	if (base === undefined || !Number.isInteger(displacement)) return undefined;
	const result = base + displacement;
	if (result < MIN_EXACT_ADDRESS_DISPLACEMENT || result > MAX_EXACT_ADDRESS_DISPLACEMENT) return undefined;
	// TwoSum's residual proves this authored addition did not itself round;
	// checking the rounded result's range alone fails at the -2^53 boundary.
	const displacementPart = result - base;
	const residual = (base - (result - displacementPart)) + (displacement - displacementPart);
	return residual === 0 ? result : undefined;
}

type StaticAddress = { readonly storage: Decl; readonly byteOffset: number };
type TypedAddress = {
	readonly storage: Decl | undefined;
	readonly byteOffset: number | undefined;
	readonly type: StructResolvedType;
	readonly pointerIndex: boolean;
};

export type LuaStaticInitializerLeaf = {
	readonly file: FileSemanticData;
	readonly expression: LuaExpression;
	readonly type: StructResolvedType;
	readonly byteOffset: number;
	readonly value: StaticInitializerScalar;
};

export type LuaStaticSourceRead = {
	readonly kind: 'typed';
	readonly file: FileSemanticData;
	readonly expression: LuaExpression;
	readonly storage: Decl | undefined;
	readonly type: StructResolvedType;
	readonly byteOffset: number | undefined;
	readonly load: boolean;
	readonly initializer: LuaStaticInitializerLeaf | undefined;
	readonly value: StaticScalar | undefined;
} | {
	readonly kind: 'invalid';
	readonly file: FileSemanticData;
	readonly expression: LuaExpression;
	readonly error: StaticSourceError;
};

type FileReads = {
	readonly reads: Map<LuaExpression, LuaStaticSourceRead | undefined>;
	readonly scalars: Map<LuaExpression, StaticScalar | undefined>;
	readonly addresses: Map<LuaExpression, StaticAddress | undefined>;
	readonly activeScalars: Set<LuaExpression>;
	readonly activeAddresses: Set<LuaExpression>;
};

/** Source-owned byte selection, separate from compiler constant admission and guest execution. */
export class LuaStaticSourceReads {
	public readonly types: StructTypes;
	private readonly files = new Map<FileSemanticData, FileReads>();
	private readonly initializers = new Map<Decl, ReadonlyMap<number, LuaStaticInitializerLeaf>>();
	private readonly controlFlows = new WeakMap<LuaStatementSequence, LuaSourceControlFlow>();

	public constructor(private readonly snapshot: LuaSemanticWorkspaceSnapshot) {
		this.types = new StructTypes(snapshot, {
			value: (file, expression) => this.moduleValue(file, expression),
			storage: (file, expression) => this.moduleStorage(file, expression),
		});
	}

	/** Undefined means non-typed, not a failed typed read that may become a Lua table lookup. */
	public read(file: FileSemanticData, expression: LuaExpression): LuaStaticSourceRead | undefined {
		const reads = this.file(file).reads;
		if (reads.has(expression)) return reads.get(expression);
		let result: LuaStaticSourceRead | undefined;
		try {
			const addressOf = expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.StringId;
			const address = this.typedAddress(file, addressOf ? expression.operand : expression);
			if (address !== undefined) {
				const load = !addressOf && expression.kind !== LuaSyntaxKind.IdentifierExpression;
				const byteOffset = address.byteOffset === undefined ? undefined : address.byteOffset >>> 0;
				let initializer: LuaStaticInitializerLeaf | undefined;
				let value: StaticScalar | undefined;
				if (load && address.storage?.kind === 'rodata' && byteOffset !== undefined) {
					initializer = this.storageInitializers(address.storage).get(byteOffset);
					// A string reference is a const-pool lane, not text bytes or a numeric word.
					if (address.type.access?.kind === 'const_pool' && initializer?.type.access?.kind === 'const_pool'
						&& address.type.size === initializer.type.size && initializer.value.kind === 'string') value = initializer.value;
				}
				result = { kind: 'typed', file, expression, storage: address.storage, type: address.type,
					byteOffset, load, initializer, value };
			}
		} catch (error) {
			if (!(error instanceof StaticSourceError)) throw error;
			result = { kind: 'invalid', file, expression, error };
		}
		reads.set(expression, result);
		return result;
	}

	/** Closed authored scalar expressions may read immutable typed leaves; compiler constants may not. */
	public scalar(file: FileSemanticData, expression: LuaExpression): StaticScalar | undefined {
		const state = this.file(file);
		if (state.scalars.has(expression)) return state.scalars.get(expression);
		if (state.activeScalars.has(expression)) return undefined;
		state.activeScalars.add(expression);
		try {
			const read = this.read(file, expression);
			const value = read === undefined ? this.scalarExpression(file, expression) : read.kind === 'typed' ? read.value : undefined;
			state.scalars.set(expression, value);
			return value;
		} finally {
			state.activeScalars.delete(expression);
		}
	}

	private scalarExpression(file: FileSemanticData, expression: LuaExpression): StaticScalar | undefined {
		switch (expression.kind) {
			case LuaSyntaxKind.NumericLiteralExpression: return { kind: 'number', value: expression.value };
			case LuaSyntaxKind.StringLiteralExpression: return { kind: 'string', value: expression.value };
			case LuaSyntaxKind.BooleanLiteralExpression: return { kind: 'boolean', value: expression.value };
			case LuaSyntaxKind.NilLiteralExpression: return { kind: 'nil' };
			case LuaSyntaxKind.SizeOfExpression: return { kind: 'number', value: this.types.resolve(file.file, expression.typeRef).size };
			case LuaSyntaxKind.OffsetOfExpression: return { kind: 'number', value: this.types.offsetOf(file.file, expression) };
			case LuaSyntaxKind.UnaryExpression: {
				if (expression.operator === LuaUnaryOperator.Length) {
					const declaration = this.directStorage(file, expression.operand) ?? this.moduleStorage(file, expression.operand);
					if (declaration !== undefined) {
						const count = this.types.storage(declaration).dimensions[0];
						if (count !== undefined) return { kind: 'number', value: count };
					}
				}
				const value = this.scalar(file, expression.operand);
				return value === undefined ? undefined : evaluateStaticUnaryOperator(expression.operator, value);
			}
			case LuaSyntaxKind.BinaryExpression: {
				const left = this.scalar(file, expression.left);
				if (left === undefined) return undefined;
				if (expression.operator === LuaBinaryOperator.And) return isStaticFalsey(left) ? left : this.scalar(file, expression.right);
				if (expression.operator === LuaBinaryOperator.Or) return isStaticFalsey(left) ? this.scalar(file, expression.right) : left;
				const right = this.scalar(file, expression.right);
				return right === undefined ? undefined : evaluateStaticBinaryOperator(expression.operator, left, right);
			}
			case LuaSyntaxKind.IdentifierExpression:
			case LuaSyntaxKind.MemberExpression:
			case LuaSyntaxKind.IndexExpression: {
				const origin = this.authoredOrigin(file, expression);
				if (origin === undefined) return undefined;
				const syntax = writtenSourceExpression(origin);
				return syntax === undefined || origin.file === file && syntax === expression ? undefined : this.scalar(origin.file, syntax);
			}
		}
	}

	private typedAddress(file: FileSemanticData, expression: LuaExpression): TypedAddress | undefined {
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			const declaration = this.declaration(file, expression);
			if (declaration === undefined) return undefined;
			if (declaration.kind === 'bss' || declaration.kind === 'data' || declaration.kind === 'rodata') {
				return { storage: declaration, byteOffset: 0, type: this.types.storage(declaration), pointerIndex: true };
			}
			const view = declaration.pointerType;
			if (view === undefined) return undefined;
			const type = this.types.resolve(declaration.file, view);
			const address = this.address(file, expression);
			return { storage: address?.storage, byteOffset: address?.byteOffset, type, pointerIndex: true };
		}
		if (expression.kind === LuaSyntaxKind.MemberExpression || expression.kind === LuaSyntaxKind.IndexExpression) {
			const base = this.typedAddress(file, expression.base);
			if (base === undefined) return undefined;
			if (expression.kind === LuaSyntaxKind.MemberExpression) {
				const field = base.type.struct?.fields.get(expression.member.name);
				if (field === undefined) throw new StaticSourceError(`Unknown field '${expression.member.name}' on type '${base.type.name}'.`, file.file, expression.span);
				return { storage: base.storage, byteOffset: exactAddressDisplacement(base.byteOffset, field.offset),
					type: field.type, pointerIndex: false };
			}
			if (base.type.dimensions.length === 0 && !base.pointerIndex) {
				throw new StaticSourceError(`Type '${base.type.name}' is not an array.`, file.file, expression.span);
			}
			const type = base.type.dimensions.length === 0 ? base.type : indexedStructType(base.type);
			const index = this.scalar(file, expression.index);
			if (index?.kind === 'number' && !Number.isInteger(index.value)) {
				throw new StaticSourceError('Struct array index must be an integer when used as a compile-time offset.', file.file, expression.index.span);
			}
			return { storage: base.storage, type, pointerIndex: false,
				byteOffset: index?.kind !== 'number' ? undefined : exactAddressDisplacement(base.byteOffset, index.value * type.size) };
		}
		if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Dereference) {
			const base = this.typedAddress(file, expression.operand);
			return base === undefined ? undefined : { ...base, pointerIndex: false };
		}
	}

	private address(file: FileSemanticData, expression: LuaExpression): StaticAddress | undefined {
		const state = this.file(file);
		if (state.addresses.has(expression)) return state.addresses.get(expression);
		if (state.activeAddresses.has(expression)) return undefined;
		state.activeAddresses.add(expression);
		try {
			const value = this.addressExpression(file, expression);
			state.addresses.set(expression, value);
			return value;
		} finally {
			state.activeAddresses.delete(expression);
		}
	}

	private addressExpression(file: FileSemanticData, expression: LuaExpression): StaticAddress | undefined {
		const storage = this.directStorage(file, expression);
		if (storage !== undefined) return { storage, byteOffset: 0 };
		if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.StringId) {
			const selected = this.typedAddress(file, expression.operand);
			return selected?.storage === undefined || selected.byteOffset === undefined ? undefined
				: { storage: selected.storage, byteOffset: selected.byteOffset };
		}
		if (expression.kind === LuaSyntaxKind.BinaryExpression
			&& (expression.operator === LuaBinaryOperator.Add || expression.operator === LuaBinaryOperator.Subtract)) {
			const left = this.address(file, expression.left), right = this.scalar(file, expression.right);
			if (left !== undefined && right?.kind === 'number') {
				const byteOffset = exactAddressDisplacement(left.byteOffset, expression.operator === LuaBinaryOperator.Subtract ? -right.value : right.value);
				return byteOffset === undefined ? undefined : { storage: left.storage, byteOffset };
			}
			if (expression.operator === LuaBinaryOperator.Add) {
				const address = this.address(file, expression.right), offset = this.scalar(file, expression.left);
				if (address !== undefined && offset?.kind === 'number') {
					const byteOffset = exactAddressDisplacement(address.byteOffset, offset.value);
					return byteOffset === undefined ? undefined : { storage: address.storage, byteOffset };
				}
			}
			return undefined;
		}
		const origin = this.authoredOrigin(file, expression);
		if (origin?.kind === 'binding-input') {
			const declaration = origin.declaration;
			if (declaration.kind === 'bss' || declaration.kind === 'data' || declaration.kind === 'rodata') return { storage: declaration, byteOffset: 0 };
		}
		if (origin === undefined) return undefined;
		const syntax = writtenSourceExpression(origin);
		return syntax === undefined || origin.file === file && syntax === expression ? undefined : this.address(origin.file, syntax);
	}

	/** One closed authored value lane; boundaries and multiple writes never disappear. */
	private authoredOrigin(file: FileSemanticData, expression: LuaExpression): LuaWrittenSource | undefined {
		const resolver = this.snapshot.symbolResolver;
		const trace = resolver.authoredSources.trace(resolver.writtenSources.expression(file, expression));
		if (!trace.unconditional && !this.dominatedBindings(file, expression, trace)) return undefined;
		if (this.snapshot.linkExports.size !== 0 && this.hasLinkedValue(trace)) return undefined;
		let origin: LuaWrittenSource | undefined;
		for (const terminal of trace.terminals) {
			if (origin !== undefined) return undefined;
			origin = terminal;
		}
		for (const boundary of trace.boundaries) {
			if (origin !== undefined || boundary.reason !== 'unknown-value' && boundary.reason !== 'unwritten-binding'
				&& boundary.reason !== 'typed-access') return undefined;
			origin = boundary.source;
		}
		return origin;
	}

	/** Follow only selected value contributions, never receiver/dependency evidence. */
	private hasLinkedValue(trace: LuaAuthoredSourceTrace): boolean {
		const query = this.snapshot.symbolResolver.writtenSources;
		let source = trace.root;
		for (let step = 0; step < trace.sources.length; step++) {
			const target = getLuaModuleAliasTarget(source.file, source.value);
			if (target !== null && target.memberPath.length !== 0) {
				const path = this.snapshot.resolveModule(target.referrer, target.module);
				if (path !== undefined && this.snapshot.linkExports.get(path)?.has(buildModuleExportPathKey(target.memberPath))) return true;
			}
			const inputs = query.inputs(source);
			if (inputs.kind === 'contributions' && inputs.sources.length === 1) source = inputs.sources[0];
			else if (inputs.kind === 'boundary' && inputs.reason === 'member-read') {
				const member = trace.memberReads.find(read => read.source === source);
				if (member === undefined || member.origins.length !== 1) return false;
				source = member.origins[0];
			} else return false;
		}
		return false;
	}

	/** Prove each non-module binding on its own written consumer edge. */
	private dominatedBindings(file: FileSemanticData, expression: LuaExpression, trace: LuaAuthoredSourceTrace): boolean {
		let remaining = 0;
		for (const source of trace.sources) {
			if (source.kind === 'declaration-write' && !source.write.unconditional) remaining++;
			else if (source.kind === 'value-transfer' && !source.write.unconditional) return false;
		}
		const query = this.snapshot.symbolResolver.writtenSources;
		let current: LuaWrittenSource = query.expression(file, expression);
		for (let step = 0; step < trace.sources.length; step++) {
			const inputs = query.inputs(current);
			if (inputs.kind !== 'contributions' || inputs.sources.length !== 1) break;
			const next = inputs.sources[0];
			if (next.kind === 'declaration-write' && !next.write.unconditional) {
				const read = writtenSourceExpression(current), write = next.write;
				if (current.file !== next.file || read?.kind !== LuaSyntaxKind.IdentifierExpression
					|| write.syntax.kind !== LuaSyntaxKind.LocalAssignmentStatement
					|| current.file.referencesBySyntax.get(read)!.target !== write.declId) return false;
				const body = write.flow === undefined ? next.file.chunk.body
					: next.file.functionValueFlows.find(flow => flow.id === write.flow)!.expression.body.body;
				let controlFlow = this.controlFlows.get(body);
				if (controlFlow === undefined) {
					controlFlow = LuaCompletionAnalysis.sourceFlow(body);
					this.controlFlows.set(body, controlFlow);
				}
				if (!controlFlow.dominates(write.syntax, read)) return false;
				remaining--;
			}
			current = next;
		}
		return remaining === 0;
	}

	private moduleOrigin(file: FileSemanticData, expression: LuaExpression): LuaWrittenSource | undefined {
		const target = getLuaModuleAliasTarget(file, readLuaExpressionSource(file, expression));
		if (target === null || target.memberPath.length === 0) return undefined;
		const path = this.snapshot.resolveModule(target.referrer, target.module);
		if (path === undefined || !this.snapshot.getFileData(path)!.chunk.constModule) return undefined;
		if (this.snapshot.linkExports.get(path)?.has(buildModuleExportPathKey(target.memberPath))) return undefined;
		return this.authoredOrigin(file, expression);
	}

	private moduleStorage(file: FileSemanticData, expression: LuaExpression): Decl | undefined {
		const origin = this.moduleOrigin(file, expression);
		if (origin?.kind !== 'binding-input') return undefined;
		const declaration = origin.declaration;
		return declaration.kind === 'bss' || declaration.kind === 'data' || declaration.kind === 'rodata' ? declaration : undefined;
	}

	private moduleValue(file: FileSemanticData, expression: LuaExpression): StaticConstantValue | undefined {
		const origin = this.moduleOrigin(file, expression);
		if (origin === undefined) return undefined;
		if (origin.kind === 'binding-input') {
			switch (origin.declaration.kind) {
				case 'bss': return { kind: 'bss_addr' };
				case 'data': return { kind: 'data_addr' };
				case 'rodata': return { kind: 'rodata_addr' };
			}
		}
		const syntax = writtenSourceExpression(origin);
		return syntax === undefined || origin.file === file && syntax === expression ? undefined : this.types.constants.evaluate(origin.file, syntax);
	}

	private directStorage(file: FileSemanticData, expression: LuaExpression): Decl | undefined {
		const declaration = this.declaration(file, expression);
		return declaration?.kind === 'bss' || declaration?.kind === 'data' || declaration?.kind === 'rodata' ? declaration : undefined;
	}

	private declaration(file: FileSemanticData, expression: LuaExpression): Decl | undefined {
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression) return undefined;
		const target = file.referencesBySyntax.get(expression)!.target;
		return target === undefined ? undefined : this.snapshot.symbolResolver.getDeclaration(target);
	}

	private storageInitializers(storage: Decl): ReadonlyMap<number, LuaStaticInitializerLeaf> {
		const retained = this.initializers.get(storage);
		if (retained !== undefined) return retained;
		const statement = this.snapshot.symbolResolver.staticDeclarations.storage(storage);
		const leaves = new Map<number, LuaStaticInitializerLeaf>();
		if (statement.kind !== LuaSyntaxKind.BssDeclarationStatement) {
			const file = this.snapshot.getFileData(storage.file)!;
			visitStaticStorageInitializer(file, this.types.storage(storage), statement.initializer,
				statement.kind === LuaSyntaxKind.DataDeclarationStatement ? '.data' : '.rodata', this.types.constants,
				(byteOffset, type, expression, value) => {
					if (value.kind === 'string') leaves.set(byteOffset, { file, expression, type, byteOffset, value });
				});
		}
		this.initializers.set(storage, leaves);
		return leaves;
	}

	private file(file: FileSemanticData): FileReads {
		let state = this.files.get(file);
		if (state === undefined) {
			state = { reads: new Map(), scalars: new Map(), addresses: new Map(), activeScalars: new Set(), activeAddresses: new Set() };
			this.files.set(file, state);
		}
		return state;
	}
}
