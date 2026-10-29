import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import type { EditorTextChange } from '../../../editor/text/text_change';
import { mapTrackedTextLocation, type TrackedTextLocation } from '../../../editor/text/text_location';
import { luaSourceStartMatchesTextLocation, luaSourceStartToTextLocation, type LuaSourceModels } from '../../../language/lua/source_location';
import { luaSourceRangeToTextLocation } from '../../../language/lua/source_location';
import { writtenSourceExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import type { LuaProgramProperty } from './source';
import { EditorEditStateType } from '../../../editor/model/edit_state';
import { mapLuaSourceReference, type LuaSourceReference } from '../../../language/lua/source_reference';
import { LuaTokenType } from '../../../../toolchain/ts/lua/syntax/token';
import type { EditorTextModel } from '../../../editor/model/text_model';

type Node = WorkbenchTreeNode<LuaProgramProperty>;
type SourceStep = { readonly binding: TrackedTextLocation; readonly table: TrackedTextLocation | undefined; readonly references: readonly LuaSourceReference[] };
export type LuaProgramSourceBookmark = { readonly path: readonly SourceStep[] };
export const luaProgramPropertyEditState = new EditorEditStateType<{
	readonly bookmark: LuaProgramSourceBookmark;
	readonly producer: TrackedTextLocation;
	readonly originIntent: number;
}>();

/** History retains source coordinates, never a property, syntax node or input. */
export function copyLuaProgramSourceBookmark(bookmark: LuaProgramSourceBookmark): LuaProgramSourceBookmark & { readonly path: SourceStep[] } {
	return { path: bookmark.path.map(step => ({ binding: { ...step.binding }, table: step.table === undefined ? undefined : { ...step.table },
		references: step.references.map(reference => ({ ...reference })) })) };
}

/** Explicit authored replacement maps its inert continuation before selecting the new value. */
export function mapLuaProgramSourceBookmark(bookmark: LuaProgramSourceBookmark, resource: ResourceIdentity, changes: readonly EditorTextChange[]): void {
	for (const step of bookmark.path) {
		mapTrackedTextLocation(step.binding, resource, changes);
		if (step.table !== undefined) mapTrackedTextLocation(step.table, resource, changes);
		for (const reference of step.references) mapTrackedTextLocation(reference, resource, changes);
	}
}

/** Selected authored occurrences, not replaceable AST objects or numbered display paths. */
export class LuaProgramSourceSelection {
	private node: Node | undefined;
	private path: readonly SourceStep[] | undefined;
	private availableValue = false;
	private retiredValue = false;
	private revisionValue = 0;
	public get revision(): number { return this.revisionValue; }
	public get available(): boolean { return this.availableValue; }
	public get retired(): boolean { return this.retiredValue; }
	public retire(): void {
		this.retiredValue = true; this.availableValue = false;
		this.node = undefined; this.path = undefined; this.revisionValue++;
	}
	public get property(): LuaProgramProperty | undefined { return this.availableValue ? this.node?.element : undefined; }
	public captureBookmark(): LuaProgramSourceBookmark { return copyLuaProgramSourceBookmark({ path: this.path! }); }
	public continueEdit(bookmark: LuaProgramSourceBookmark, originIntent: number, history: boolean): void {
		if (!history && this.revisionValue !== originIntent) return;
		if (history) this.revisionValue++;
		this.path = copyLuaProgramSourceBookmark(bookmark).path;
		this.availableValue = true;
	}

	public select(node: Node | undefined, models: LuaSourceModels): void {
		if (this.node === node) return;
		this.node = node;
		this.path = node === undefined ? undefined : this.capture(node, models);
		this.availableValue = node !== undefined;
		this.revisionValue++;
	}

	/** Reparse publishes correspondence without manufacturing a new selected intent. */
	public reconcile(node: Node | undefined, models: LuaSourceModels): void {
		if (node === undefined && this.path !== undefined) this.revisionValue++;
		this.node = node;
		this.path = node === undefined ? undefined : this.capture(node, models);
		this.availableValue = node !== undefined;
	}

	public matches(node: Node, models: LuaSourceModels): boolean {
		if (!this.availableValue) return false;
		let current: Node | null = node;
		for (let index = this.path!.length - 1; index >= 0; index--) {
			if (current === null) return false;
			const step = this.path![index], property = current.element;
			if (!luaSourceStartMatchesTextLocation(models, property.file.chunk.locations.range((property.field ?? property.expression).span), step.binding)) return false;
			if (step.table === undefined ? property.table !== undefined : property.table === undefined
				|| !luaSourceStartMatchesTextLocation(models, property.table.file.chunk.locations.range(property.table.table.span), step.table)) return false;
			current = current.parent;
		}
		return current === null;
	}

	public mapSourceChange(model: EditorTextModel, changes: readonly EditorTextChange[]): void {
		if (!this.availableValue) return;
		const resource = model.identity;
		for (const step of this.path!) {
			mapTrackedTextLocation(step.binding, resource, changes);
			if (step.table !== undefined) mapTrackedTextLocation(step.table, resource, changes);
			for (const reference of step.references) if (resourceIdentityEquals(reference.resource, resource)
				&& !mapLuaSourceReference(reference, model.buffer, changes)) {
				this.availableValue = false;
				return;
			}
			if (step.binding.start === step.binding.end || step.table !== undefined && step.table.start === step.table.end) {
				this.availableValue = false;
				return;
			}
		}
	}

	private capture(node: Node, models: LuaSourceModels): SourceStep[] {
		const path: SourceStep[] = [];
		for (let current: Node | null = node; current !== null; current = current.parent) {
			const property = current.element;
			const references: LuaSourceReference[] = [];
			const expressions = new Set<LuaExpression>();
			for (let traceIndex = 0; traceIndex < 2; traceIndex++) {
				const trace = traceIndex === 0 ? property.sourceTrace : property.producerTrace;
				if (trace === undefined) continue;
				for (const source of trace.sources) {
					let binding: LuaExpression | undefined;
					if (source.kind === 'declaration-write' || source.kind === 'value-transfer') {
						const { syntax, index } = source.write;
						if (syntax.kind === LuaSyntaxKind.LocalAssignmentStatement) binding = syntax.names[index];
						else if (syntax.kind === LuaSyntaxKind.AssignmentStatement) binding = syntax.left[index];
						else if (syntax.kind === LuaSyntaxKind.TableConstructorExpression) {
							const field = syntax.fields[index];
							if (field.kind === LuaTableFieldKind.ExpressionKey) binding = field.key;
							else if (field.kind === LuaTableFieldKind.IdentifierKey) {
								const location = luaSourceStartToTextLocation(models, source.file.chunk.locations.range(field.span));
								references.push({ ...location, end: location.start + field.name.length, token: LuaTokenType.Identifier });
							}
						}
					}
					const expression = trace.terminals.includes(source) ? undefined : writtenSourceExpression(source);
					for (let lane = 0; lane < 2; lane++) {
						const syntaxRoot = lane === 0 ? binding : expression;
						if (syntaxRoot === undefined) continue;
						walkLuaAst(syntaxRoot, syntax => {
						if (syntax.kind === LuaSyntaxKind.TableConstructorExpression || syntax.kind === LuaSyntaxKind.FunctionExpression) return false;
						if ((syntax.kind === LuaSyntaxKind.IdentifierExpression || syntax.kind === LuaSyntaxKind.StringLiteralExpression
							|| syntax.kind === LuaSyntaxKind.NumericLiteralExpression) && !expressions.has(syntax)) {
							expressions.add(syntax);
							references.push({ ...luaSourceRangeToTextLocation(models, source.file.chunk.locations.range(syntax.span)),
								token: syntax.kind === LuaSyntaxKind.IdentifierExpression ? LuaTokenType.Identifier
									: syntax.kind === LuaSyntaxKind.StringLiteralExpression ? LuaTokenType.String : LuaTokenType.Number });
						}
					});
					}
				}
			}
			path.push({ binding: luaSourceStartToTextLocation(models, property.file.chunk.locations.range((property.field ?? property.expression).span)),
				table: property.table === undefined ? undefined
					: luaSourceStartToTextLocation(models, property.table.file.chunk.locations.range(property.table.table.span)), references });
		}
		path.reverse();
		return path;
	}
}
