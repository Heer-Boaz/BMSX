import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { SceneAuthoredSelection, SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocument, SceneSourceDefinition } from './model';
import { collectSceneOptionProperties, type SceneOptionProperty } from './option_properties';
import { scenePositionAxisEditable } from './spatial_edits';

export const POSITION_AXES = ['x', 'y', 'z'] as const;

/** Semantic local coordinates, independent of written overrides, controls and measured presentation. */
export type ScenePositionProperty = {
	readonly axis: typeof POSITION_AXES[number];
	readonly family: '2d' | '3d';
	readonly value: number;
	readonly editable: boolean;
	readonly preview?: string;
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
	readonly positionExpression?: string;
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
	private spatialGeneration: object | undefined;

	public constructor(public readonly authoring: SceneAuthoringContext) {}

	public refresh(): boolean {
		const selection = this.authoring.selection, sourceRevision = this.authoring.revision;
		const spatialGeneration = this.authoring.spatialGeneration;
		if (sourceRevision === this.sourceRevision && selection === this.subject?.selection && spatialGeneration === this.spatialGeneration) return false;
		this.sourceRevision = sourceRevision;
		this.spatialGeneration = spatialGeneration;
		this.revision++;
		if (selection === undefined) { this.subject = undefined; return true; }
		const document = this.authoring.document!, locations = document.analysis.chunk.locations;
		const { buffer, version } = this.authoring.workingCopy, scene = selection.scene;
		let label: string, detail: string, preserveLabelCase: boolean, preserveDetailCase: boolean;
		let properties: readonly ScenePositionProperty[] = NO_PROPERTIES, optionProperties: readonly SceneOptionProperty[] = NO_PROPERTIES;
		let positionExpression: string | undefined;
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
			const local = this.authoring.selectedLocalTransform;
			if (entry.kind === 'object' && entry.position !== null && entry.position.value.kind !== LuaSyntaxKind.NilLiteralExpression
				&& (entry.position.value.kind !== LuaSyntaxKind.TableConstructorExpression || local === undefined)) {
				positionExpression = readLuaSourceRange(buffer, locations.range(entry.position.value.span));
			} else if (entry.kind === 'object' && local !== undefined) {
				const position = entry.position?.value;
				const property = (axis: ScenePositionProperty['axis'], value: number): ScenePositionProperty => {
					const editable = scenePositionAxisEditable(entry, axis);
					const field = position?.kind === LuaSyntaxKind.TableConstructorExpression ? findNamedLuaTableField(position, axis) : null;
					return { axis, family: local.family, value, editable,
						preview: !editable && field !== null ? readLuaExpressionPreview(buffer, locations, field.value) : undefined };
				};
				properties = local.family === '2d' ? [property('x', local.ox), property('y', local.oy)]
					: [property('x', local.ox), property('y', local.oy), property('z', local.oz)];
			}
		}
		this.subject = { selection, document, sourceVersion: version, label, preserveLabelCase, detail, preserveDetailCase,
			resolution: scene.resolution, positionExpression, properties, optionProperties };
		return true;
	}
}
