import type { CapturedLocalDebug } from './program';
import { CapturedLocalKind } from './capture_kind';
import { LuaSourceCorrespondence } from '../semantic/source_correspondence';
import { sourceRangeKey } from '../semantic/source_range';
import type { SourceRange } from '../source_range';

export type LuaCaptureBaseline = {
	functionIds: readonly string[];
	functionDefinitions: ReadonlyArray<SourceRange | null>;
	capturedLocals: readonly (Omit<CapturedLocalDebug, 'definition'> & { definition: SourceRange | null })[];
	upvalueBindingsByFunction: ReadonlyArray<ReadonlyArray<number>>;
};

/** Previous live cell slots, not a recipe for reading registers from old frames. */
export class LuaCaptureLayout {
	private readonly functions = new Map<string, readonly number[]>();
	private readonly functionIdsByDefinition = new Map<string, Map<string, string>>();
	private readonly definitions = new Map<number, SourceRange>();

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

	public definition(index: number): SourceRange {
		let definition = this.definitions.get(index);
		if (definition === undefined) {
			const local = this.baseline.capturedLocals[index];
			if (local.definition === null) {
				throw new Error(`Hot resume cannot retain capture '${local.name}': its defining declaration was removed.`);
			}
			definition = local.kind === CapturedLocalKind.Receiver
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
