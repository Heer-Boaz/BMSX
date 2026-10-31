import { LuaSyntaxKind, LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { appendAffine2, type Affine2 } from '../../../common/affine2';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';
import { readSceneSourceAffine } from './authored_affine';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';
import type { ScenePrefabSources } from './prefab_sources';
import type { SceneSpatialProjection } from './spatial_projection';

export type SceneSpriteSource = {
	readonly entry: SceneSourceObject;
	readonly image: string;
	readonly affine: Readonly<Affine2>;
	readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	/** Opaque host tint: the sprite packet consumes the authored color's RGB only. */
	readonly color: number;
	readonly flipH: boolean;
	readonly flipV: boolean;
	readonly order: number;
};
/** Declared constructor inputs, not a guest instance or a gameplay-time frame. */
export type SceneVisualReadModel = { readonly sprites: readonly SceneSpriteSource[] };
type SourceState = LuaWrittenExpression | null | undefined;
type SpriteProducer = { readonly id: string; readonly defaults: SourceState; readonly primary?: true };
const SPRITE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['new'] };
const SPRITE_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['factory'] };
const SPRITE_OBJECT: LuaModuleImportTarget = { module: 'cartlib/sprite', memberPath: [] };
const IDENTITY: Readonly<Affine2> = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };

/** Selects the real shallow component-input merge before the constructor's
 * distinct nil-only and `or` default rules. Unknown writes never grant defaults. */
class SpriteConstructorInputs {
	public constructor(private readonly reader: LuaSourceReader, private readonly scene: SourceState,
		private readonly prefab: SourceState, private readonly defaults: SourceState) {}
	public member(source: SourceState, name: string): SourceState {
		if (source === undefined || source === null) return source;
		if (source.expression.kind === LuaSyntaxKind.NilLiteralExpression) return null;
		const value = this.reader.memberState(source.file, source.expression, name);
		return value?.expression.kind === LuaSyntaxKind.NilLiteralExpression ? null : value;
	}
	public value(name: string, truthyDefault = false): SourceState {
		let input = this.member(this.scene, name);
		if (input === null) input = this.member(this.prefab, name);
		if (input === undefined) return;
		if (input !== null && (!truthyDefault || readLuaSourceTruth(input) !== false)) return input;
		return this.member(this.defaults, name);
	}
	public number(name: string, fallback: number): number | undefined {
		const value = this.value(name), truth = readLuaSourceTruth(value);
		if (truth === undefined) return;
		return truth === false ? fallback : readLuaNumberExpression(value!.expression) ?? undefined;
	}
	public flag(name: string, fallback: boolean): boolean | undefined {
		const value = this.value(name);
		return value === null ? fallback : readLuaSourceTruth(value);
	}
}

/** Retained source generation and exact source occurrences. It borrows the
 * spatial owner's poses/order and does no asset lookup, Lua execution or paint. */
export class SceneVisualProjection {
	private readonly scenes = new WeakMap<SceneSourceDefinition, SceneVisualReadModel>();
	private readonly producers = new WeakMap<LuaWrittenExpression, SpriteProducer[]>();
	private readonly inheritedVisibility = new WeakMap<LuaWrittenExpression, SourceState>();
	private readonly reader: LuaSourceReader;
	private readonly fields: SpriteConstructorInputs;
	public constructor(private readonly prefabs: ScenePrefabSources, private readonly spatial: SceneSpatialProjection) {
		this.reader = prefabs.reader; this.fields = new SpriteConstructorInputs(this.reader, null, null, null);
	}
	public readScene(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneVisualReadModel {
		const retained = this.scenes.get(scene); if (retained !== undefined) return retained;
		const sprites: SceneSpriteSource[] = [], reader = this.reader, fields = this.fields, spatial = this.spatial.readScene(document, scene);
		for (const entry of spatial.constructionOrder) {
			const world = spatial.worlds.get(entry); if (world?.family !== '2d') continue;
			const member = reader.expression(document.analysis, entry.field.value)!;
			const definitionSource = reader.member(member.file, member.expression, 'definition_id');
			const id = definitionSource === undefined ? undefined : reader.stringValue(definitionSource.file, definitionSource.expression);
			const definition = id === undefined ? undefined : this.prefabs.all.get(id); if (definition === undefined) continue;
			const options = fields.member(member, 'options'), defaults = fields.member(definition, 'defaults');
			const ownerInputs = new SpriteConstructorInputs(reader, readLuaSourceTruth(options) === false ? null : options,
				readLuaSourceTruth(defaults) === false ? null : defaults, null);
			let ownerVisible = ownerInputs.value('visible');
			if (ownerVisible === null) ownerVisible = this.classVisibility(definition);
			if (ownerVisible !== null && readLuaSourceTruth(ownerVisible) !== true) continue;
			const memberInitial = fields.member(member, 'initial'), prefabInitial = fields.member(definition, 'initial');
			for (const producer of this.readProducers(definition)) {
				if (producer.primary && ownerInputs.value('primary_sprite_factory') !== null) continue;
				const inputs = new SpriteConstructorInputs(reader, fields.member(memberInitial, producer.id), fields.member(prefabInitial, producer.id), producer.defaults);
				if (inputs.flag('enabled', true) !== true || inputs.flag('visible', true) !== true) continue;
				const imageSource = inputs.value('imgid');
				const image = imageSource === undefined || imageSource === null ? undefined : reader.stringValue(imageSource.file, imageSource.expression);
				if (image === undefined) continue;
				const color = inputs.number('color', 0xffffffff), flipH = inputs.flag('flip_h', false), flipV = inputs.flag('flip_v', false);
				const order = inputs.number('order', 0), presentationOrder = inputs.number('presentation_order', 0);
				if (color === undefined || flipH === undefined || flipV === undefined || order === undefined || presentationOrder === undefined) continue;
				const attachment = this.affine(inputs.value('attachment_affine', true)), presentation = this.affine(inputs.value('presentation_affine', true));
				if (attachment === undefined || presentation === undefined) continue;
				const regionSource = inputs.value('region', true);
				let region: SceneSpriteSource['region'];
				if (regionSource === undefined) continue;
				if (regionSource !== null) {
					const x = fields.member(regionSource, 'x'), y = fields.member(regionSource, 'y');
					const width = fields.member(regionSource, 'width'), height = fields.member(regionSource, 'height');
					if (x == null || y == null || width == null || height == null) continue;
					const nx = readLuaNumberExpression(x.expression), ny = readLuaNumberExpression(y.expression);
					const nw = readLuaNumberExpression(width.expression), nh = readLuaNumberExpression(height.expression);
					if (nx === null || ny === null || nw === null || nh === null) continue;
					region = { x: nx, y: ny, width: nw, height: nh };
				}
				const affine: Affine2 = { xx: world.xx, xy: world.xy, yx: world.yx, yy: world.yy, ox: world.ox, oy: world.oy };
				appendAffine2(affine, attachment.xx, attachment.xy, attachment.yx, attachment.yy, attachment.ox, attachment.oy);
				appendAffine2(affine, presentation.xx, presentation.xy, presentation.yx, presentation.yy, presentation.ox, presentation.oy);
				sprites.push({ entry, image, affine, region, color: (color | 0xff000000) >>> 0, flipH, flipV, order: order + presentationOrder });
			}
		}
		// Stable host sort preserves the already admitted fresh-instance sequence.
		sprites.sort((a, b) => a.order - b.order);
		const result = { sprites }; this.scenes.set(scene, result); return result;
	}
	private affine(source: SourceState): Readonly<Affine2> | undefined {
		if (readLuaSourceTruth(source) === false) return IDENTITY;
		if (source === undefined || source === null) return;
		const affine = readSceneSourceAffine(this.reader, source.file, source.expression);
		return affine?.family === '2d' ? affine : undefined;
	}
	/** Prefab admission copies own class members before its chosen base. A
	 * class's preexisting __index is replaced unless class and base are the same
	 * source. Unknown inherited data is not the nil default from _initialize. */
	private classVisibility(definition: LuaWrittenExpression): SourceState {
		if (this.inheritedVisibility.has(definition)) return this.inheritedVisibility.get(definition);
		const selected = this.fields.member(definition, 'class');
		let value: SourceState;
		if (selected?.expression.kind === LuaSyntaxKind.TableConstructorExpression) {
			value = this.reader.ownMemberState(selected.file, selected.expression, 'visible');
			if (value?.expression.kind === LuaSyntaxKind.NilLiteralExpression) value = null;
			if (value === null) {
				let base = this.fields.member(definition, 'base');
				if (readLuaSourceTruth(base) === false) base = this.reader.module(definition.file, 'cartlib/world/world_object');
				if (base?.expression.kind === LuaSyntaxKind.TableConstructorExpression) {
					value = this.fields.member(base, 'visible');
				} else value = undefined;
			}
		}
		this.inheritedVisibility.set(definition, value);
		return value;
	}
	private readProducers(definition: LuaWrittenExpression): readonly SpriteProducer[] {
		let producers = this.producers.get(definition);
		if (producers === undefined) {
			producers = [];
			const fields = this.fields;
			const componentModule = this.reader.module(definition.file, SPRITE_NEW.module);
			const constructor = fields.member(componentModule, 'new'), factory = fields.member(componentModule, 'factory');
			const raw = definition.expression;
			if (raw.kind === LuaSyntaxKind.TableConstructorExpression) {
				const classField = findNamedLuaTableField(raw, 'class');
				if (classField !== null) {
					const source = this.reader.snapshot.symbolResolver.writtenSources.expression(definition.file, classField.value);
					const target = getLuaModuleAliasTarget(definition.file, source.value);
					const selected = fields.member(definition, 'class');
					const initialize = fields.member(selected, 'initialize'), primary = fields.member(selected, 'primary_sprite_factory');
					if (target !== null && this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, SPRITE_OBJECT)
						&& initialize?.expression.kind === LuaSyntaxKind.FunctionExpression && primary?.expression.kind === LuaSyntaxKind.FunctionExpression
						&& primary === constructor)
						producers.push({ id: 'base_sprite', defaults: null, primary: true });
				}
			}
			const components = fields.member(definition, 'components');
			if (components?.expression.kind === LuaSyntaxKind.TableConstructorExpression
				&& !this.reader.snapshot.symbolResolver.authoredSources.tableMutations().has(components.expression)
				&& components.expression.fields.every(field => field.kind === LuaTableFieldKind.Array)) {
				for (const field of components.expression.fields) {
					const source = this.reader.snapshot.symbolResolver.writtenSources.expression(components.file, field.value);
					const direct = getLuaModuleAliasTarget(components.file, source.value);
					if (direct !== null && this.reader.snapshot.symbolResolver.moduleImports.matchesImport(direct, SPRITE_NEW)
						&& constructor?.expression.kind === LuaSyntaxKind.FunctionExpression
						&& this.reader.callable(components.file, field.value) === constructor) { producers.push({ id: 'sprite', defaults: null }); continue; }
					const call = this.reader.call(components.file, field.value); if (call === undefined || call.expression.method !== null) continue;
					const file = this.reader.snapshot.getFileData(call.file)!, target = getLuaModuleAliasTarget(file, call.callee);
					if (target === null || !this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, SPRITE_FACTORY)
						|| constructor?.expression.kind !== LuaSyntaxKind.FunctionExpression || factory?.expression.kind !== LuaSyntaxKind.FunctionExpression
						|| this.reader.callable(file, call.expression.callee) !== factory) continue;
					const argument = call.expression.arguments[0], defaults = argument === undefined ? undefined : this.reader.expression(file, argument);
					if (defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
					const identity = fields.member(defaults, 'id_local');
					const id = readLuaSourceTruth(identity) === false ? 'sprite' : identity == null ? undefined : this.reader.stringValue(identity.file, identity.expression);
					if (id !== undefined) producers.push({ id, defaults });
				}
			}
			this.producers.set(definition, producers);
		}
		return producers;
	}
}
