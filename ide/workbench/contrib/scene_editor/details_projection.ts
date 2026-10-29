import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import { readLuaExpressionPreview, readLuaSourceRange, readLuaTableFieldInteger } from '../../../language/lua/source_edits';
import type { SceneAuthoredSelection, SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocument, SceneSourceDefinition } from './model';
import { collectSceneOptionProperties, type SceneOptionProperty } from './option_properties';

export const POSITION_AXES = ['x', 'y', 'z'] as const;

/** Written source facts, independent of any field control or measured presentation. */
export type ScenePositionProperty = {
	readonly axis: typeof POSITION_AXES[number];
	readonly field: LuaTableField | null;
	readonly value: number | null;
	readonly sourceText: string | undefined;
};

export type SceneDetailsSubject = {
	readonly selection: SceneAuthoredSelection;
	readonly document: SceneSourceDocument;
	readonly sourceVersion: number;
	readonly label: string;
	readonly preserveLabelCase: boolean;
	readonly detail: string;
	readonly preserveDetailCase: boolean;
	readonly resolution: SceneSourceDefinition['resolution'];
	readonly properties: readonly ScenePositionProperty[];
	readonly optionProperties: readonly SceneOptionProperty[];
};

const NO_PROPERTIES: readonly [] = [];

/** Selected source projection. Hierarchy rows, view placement and field authority are not inputs. */
export class SceneDetailsProjection {
	public subject: SceneDetailsSubject | undefined;
	/** Descriptor publication, including authority retirement without a new semantic document. */
	public revision = 0;
	private sourceRevision = -1;

	public constructor(public readonly authoring: SceneAuthoringContext) {}

	public refresh(): boolean {
		const selection = this.authoring.selection, sourceRevision = this.authoring.revision;
		if (sourceRevision === this.sourceRevision && selection === this.subject?.selection) return false;
		this.sourceRevision = sourceRevision;
		this.revision++;
		if (selection === undefined) { this.subject = undefined; return true; }
		const document = this.authoring.document!, locations = document.analysis.chunk.locations;
		const { buffer, version } = this.authoring.workingCopy, scene = selection.scene;
		let label: string, detail: string, preserveLabelCase: boolean, preserveDetailCase: boolean;
		let properties: readonly ScenePositionProperty[] = NO_PROPERTIES, optionProperties: readonly SceneOptionProperty[] = NO_PROPERTIES;
		if (selection.kind === 'scene') {
			const id = stringLiteralValue(scene.id);
			label = id === undefined ? readLuaExpressionPreview(buffer, locations, scene.id) : id;
			preserveLabelCase = id !== undefined;
			detail = `${scene.objects.length} MEMBERS${scene.resolution === 'partial' ? ' (PARTIAL)' : ''}`;
			preserveDetailCase = false;
		} else {
			const entry = selection.entry, memberId = entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined;
			label = memberId === undefined ? readLuaExpressionPreview(buffer, locations, entry.kind === 'object' ? entry.memberId : entry.field.value) : memberId;
			preserveLabelCase = memberId !== undefined;
			if (entry.kind === 'object') {
				const definitionId = stringLiteralValue(entry.definitionId);
				detail = definitionId === undefined ? readLuaExpressionPreview(buffer, locations, entry.definitionId) : definitionId;
				preserveDetailCase = definitionId !== undefined;
				optionProperties = collectSceneOptionProperties(buffer, locations, entry);
			} else { detail = 'Dynamic Lua composition'; preserveDetailCase = false; }
			properties = POSITION_AXES.map(axis => {
				const field = entry.kind === 'object' && entry.position !== null ? entry.position[axis] : null;
				return { axis, field, value: field === null ? null : readLuaTableFieldInteger(field),
					sourceText: field === null ? undefined : readLuaSourceRange(buffer, locations.range(field.value.span)) };
			});
		}
		this.subject = { selection, document, sourceVersion: version, label, preserveLabelCase, detail, preserveDetailCase,
			resolution: scene.resolution, properties, optionProperties };
		return true;
	}
}
