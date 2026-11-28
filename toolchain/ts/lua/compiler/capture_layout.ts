import type { LexicalDeclarationDebug } from './program';
import { LexicalDeclarationKind } from './declaration_kind';
import { LuaSourceCorrespondence } from '../semantic/source_correspondence';
import { sourceRangeKey } from '../semantic/source_range';
import type { SourceRange } from '../source_range';

export type LuaCaptureBaseline = {
	functionIds: readonly string[];
	functionDefinitions: ReadonlyArray<SourceRange | null>;
	lexicalDeclarations: readonly (Omit<LexicalDeclarationDebug, 'definition'> & { definition: SourceRange | null })[];
	upvalueBindingsByFunction: ReadonlyArray<ReadonlyArray<number>>;
};

/** Previous live cell slots, not a recipe for reading registers from old frames. */
export class LuaCaptureLayout {
	private readonly functions = new Map<string, readonly number[]>();
	private readonly functionIdsByDefinition = new Map<string, Map<string, string>>();
	private readonly definitions = new Map<number, SourceRange>();
	private retainedDeclarations?: ReadonlySet<string>;

	constructor(
		public readonly baseline: LuaCaptureBaseline,
		public readonly sources: LuaSourceCorrespondence,
	) {
		for (let index = 0; index < baseline.functionIds.length; index += 1) {
			this.functions.set(baseline.functionIds[index], baseline.upvalueBindingsByFunction[index]);
			const definition = baseline.functionDefinitions[index];
			if (definition !== null) {
				let functions = this.functionIdsByDefinition.get(definition.path);
				if (functions === undefined) {
					functions = new Map();
					this.functionIdsByDefinition.set(definition.path, functions);
				}
				functions.set(sourceRangeKey(definition), baseline.functionIds[index]);
			}
		}
	}

	public functionId(range: SourceRange): string | undefined {
		const previous = this.sources.previousFunctionRange(range);
		return previous === undefined ? undefined : this.functionIdsByDefinition.get(previous.path)?.get(sourceRangeKey(previous));
	}

	public hasFunction(id: string): boolean { return this.functions.has(id); }

	public slots(id: string): readonly number[] | undefined { return this.functions.get(id); }

	public retainsClosure(declaration: SourceRange, expression: SourceRange): boolean {
		const id = this.functionId(expression);
		if (id !== undefined && this.functions.get(id)!.length !== 0) return true;
		if (this.retainedDeclarations === undefined) {
			const slots = new Set(this.baseline.upvalueBindingsByFunction.flat());
			const retained = new Set<string>();
			for (const slot of slots) {
				const previous = this.baseline.lexicalDeclarations[slot];
				if (previous.definition === null || previous.kind !== LexicalDeclarationKind.Local) continue;
				const mapped = this.sources.declaration(previous.definition);
				if (mapped !== undefined) retained.add(`${mapped.path}:${sourceRangeKey(mapped)}`);
			}
			this.retainedDeclarations = retained;
		}
		return this.retainedDeclarations.has(`${declaration.path}:${sourceRangeKey(declaration)}`);
	}

	public definition(index: number): SourceRange {
		let definition = this.definitions.get(index);
		if (definition === undefined) {
			const local = this.baseline.lexicalDeclarations[index];
			if (local.definition === null) {
				throw new Error(`Hot resume cannot retain capture '${local.name}': its defining declaration was removed.`);
			}
			definition = local.kind === LexicalDeclarationKind.Receiver
				? this.sources.functionRange(local.definition)
				: this.sources.declaration(local.definition);
			if (definition === undefined) {
				throw new Error(`Hot resume cannot map captured declaration '${local.name}' in '${local.functionId}'.`);
			}
			this.definitions.set(index, definition);
		}
		return definition;
	}
}
