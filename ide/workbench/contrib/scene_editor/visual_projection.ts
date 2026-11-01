import { LuaSyntaxKind, LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import type { Affine2 } from '../../../common/affine2';
import type { Affine3 } from '../../../../machine/ts/common/affine3';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';
import { readSceneSourceAffine } from './authored_affine';
import type { SceneSourceAffine, SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';
import type { ScenePrefabSources } from './prefab_sources';
import type { SceneSpatialProjection } from './spatial_projection';

export type SceneSpriteSource = {
	readonly entry: SceneSourceObject;
	readonly image: string;
	/** Borrowed admitted spatial pose; visual placement never rewrites it. */
	readonly world: Readonly<Affine2>;
	readonly attachment: Readonly<Affine2>;
	readonly presentation: Readonly<Affine2>;
	readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	/** Opaque host tint: the sprite packet consumes the authored color's RGB only. */
	readonly color: number;
	readonly flipH: boolean;
	readonly flipV: boolean;
	readonly order: number;
};
export type SceneModelSource = {
	readonly entry: SceneSourceObject;
	readonly model: string;
	/** Proved absent selects the model asset's declared default scene. */
	readonly sceneIndex?: number;
	/** Borrowed admitted spatial pose; attachment and presentation keep their append order. */
	readonly world: Readonly<Affine3>;
	readonly attachment: Readonly<Affine3>;
	readonly presentation: Readonly<Affine3>;
};
/** Declared constructor inputs, not a guest instance or a gameplay-time frame. */
export type SceneVisualReadModel = { readonly sprites: readonly SceneSpriteSource[]; readonly models: readonly SceneModelSource[] };
type SourceState = LuaWrittenExpression | null | undefined;
type ComponentProducer = { readonly kind: 'sprite' | 'model'; readonly defaults: SourceState; readonly primary?: true };
const SPRITE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['new'] };
const SPRITE_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['factory'] };
const MODEL_NEW: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['new'] };
const MODEL_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['factory'] };
const SPRITE_OBJECT: LuaModuleImportTarget = { module: 'cartlib/sprite', memberPath: [] };
const SPRITE_COMPONENT = { kind: 'sprite' as const, constructor: SPRITE_NEW };
const MODEL_COMPONENT = { kind: 'model' as const, constructor: MODEL_NEW };
const IDENTITY_2D: SceneSourceAffine = { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
const IDENTITY_3D: SceneSourceAffine = { family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };

/** Resolves concrete constructor configuration using the producer's nil-only
 * and `or` default rules. Unknown writes never grant defaults. */
class ComponentConstructorInputs {
	public constructor(private readonly reader: LuaSourceReader, private readonly input: SourceState,
		private readonly defaults: SourceState) {}
	public member(source: SourceState, name: string): SourceState {
		if (source === undefined || source === null) return source;
		if (source.expression.kind === LuaSyntaxKind.NilLiteralExpression) return null;
		const value = this.reader.memberState(source.file, source.expression, name);
		return value?.expression.kind === LuaSyntaxKind.NilLiteralExpression ? null : value;
	}
	public value(name: string): SourceState {
		const input = this.member(this.input, name);
		return input === null ? this.member(this.defaults, name) : input;
	}
	public number(name: string, fallback: number): number | null | undefined {
		const value = this.value(name), truth = readLuaSourceTruth(value);
		if (truth === undefined) return;
		return truth === false ? fallback : readLuaNumberExpression(value!.expression);
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
	private readonly producers = new WeakMap<LuaWrittenExpression, ComponentProducer[]>();
	private readonly inheritedVisibility = new WeakMap<LuaWrittenExpression, SourceState>();
	private readonly reader: LuaSourceReader;
	private readonly fields: ComponentConstructorInputs;
	public constructor(private readonly prefabs: ScenePrefabSources, private readonly spatial: SceneSpatialProjection) {
		this.reader = prefabs.reader; this.fields = new ComponentConstructorInputs(this.reader, null, null);
	}
	public readScene(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneVisualReadModel {
		const retained = this.scenes.get(scene); if (retained !== undefined) return retained;
		const sprites: SceneSpriteSource[] = [], models: SceneModelSource[] = [];
		const reader = this.reader, fields = this.fields, spatial = this.spatial.readScene(document, scene);
		for (const entry of spatial.constructionOrder) {
			const world = spatial.worlds.get(entry); if (world === undefined) continue;
			const member = reader.expression(document.analysis, entry.field.value)!;
			const definitionSource = reader.member(member.file, member.expression, 'definition_id');
			const id = definitionSource === undefined ? undefined : reader.stringValue(definitionSource.file, definitionSource.expression);
			const definition = id === undefined ? undefined : this.prefabs.all.get(id); if (definition === undefined) continue;
			const options = fields.member(member, 'options'), defaults = fields.member(definition, 'defaults');
			const ownerInputs = new ComponentConstructorInputs(reader, readLuaSourceTruth(options) === false ? null : options,
				readLuaSourceTruth(defaults) === false ? null : defaults);
			let ownerVisible = ownerInputs.value('visible');
			if (ownerVisible === null) ownerVisible = this.classVisibility(definition);
			if (ownerVisible !== null && readLuaSourceTruth(ownerVisible) !== true) continue;
			for (const producer of this.readProducers(definition)) {
				if ((producer.kind === 'sprite') !== (world.family === '2d')) continue;
				if (producer.primary && ownerInputs.value('primary_sprite_factory') !== null) continue;
				const inputs = producer.primary ? ownerInputs : new ComponentConstructorInputs(reader, null, producer.defaults);
				if (!producer.primary && (inputs.flag('enabled', true) !== true || inputs.flag('visible', true) !== true)) continue;
				const attachment = this.affine(inputs.value('attachment_affine'), world.family);
				const presentation = this.affine(inputs.value('presentation_affine'), world.family);
				if (world.family === '3d') {
					if (attachment?.family !== '3d' || presentation?.family !== '3d') continue;
					const modelSource = inputs.value('model_id'), sceneSource = inputs.value('scene_index');
					if (modelSource == null || sceneSource === undefined) continue;
					const model = reader.stringValue(modelSource.file, modelSource.expression);
					if (model === undefined) continue;
					const sceneIndex = sceneSource === null ? undefined : readLuaNumberExpression(sceneSource.expression);
					if (sceneIndex === null) continue;
					models.push({ entry, model, sceneIndex, world, attachment, presentation });
					continue;
				}
				if (attachment?.family !== '2d' || presentation?.family !== '2d') continue;
				const imageSource = inputs.value('imgid');
				const image = imageSource === undefined || imageSource === null ? undefined : reader.stringValue(imageSource.file, imageSource.expression);
				if (image === undefined) continue;
				const color = inputs.number('color', 0xffffffff), flipH = inputs.flag('flip_h', false), flipV = inputs.flag('flip_v', false);
				const order = inputs.number('order', 0), presentationOrder = inputs.number('presentation_order', 0);
				if (color == null || flipH === undefined || flipV === undefined || order == null || presentationOrder == null) continue;
				let regionSource = inputs.value('region');
				if (producer.primary && readLuaSourceTruth(regionSource) === false) regionSource = null;
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
				sprites.push({ entry, image, world, attachment, presentation, region, color: (color | 0xff000000) >>> 0, flipH, flipV, order: order + presentationOrder });
			}
		}
		// Stable host sort preserves the already admitted fresh-instance sequence.
		sprites.sort((a, b) => a.order - b.order);
		const result = { sprites, models }; this.scenes.set(scene, result); return result;
	}
	private affine(source: SourceState, family: '2d' | '3d'): Readonly<SceneSourceAffine> | undefined {
		if (readLuaSourceTruth(source) === false) return family === '2d' ? IDENTITY_2D : IDENTITY_3D;
		if (source === undefined || source === null) return;
		const affine = readSceneSourceAffine(this.reader, source.file, source.expression);
		return affine?.family === family ? affine : undefined;
	}
	/** Visibility follows the same captured class lineage as runtime admission. */
	private classVisibility(definition: LuaWrittenExpression): SourceState {
		if (!this.inheritedVisibility.has(definition))
			this.inheritedVisibility.set(definition, this.prefabs.classMember(definition, 'visible'));
		return this.inheritedVisibility.get(definition);
	}
	private readProducers(definition: LuaWrittenExpression): readonly ComponentProducer[] {
		let producers = this.producers.get(definition);
		if (producers === undefined) {
			producers = [];
			const fields = this.fields;
			const sprite = this.reader.module(definition.file, SPRITE_OBJECT.module);
			if (sprite !== undefined && this.prefabs.classes(definition)?.includes(sprite)) {
				const componentModule = this.reader.module(definition.file, SPRITE_NEW.module), constructor = fields.member(componentModule, 'new');
				const initialize = this.prefabs.classMember(definition, 'initialize'), primary = this.prefabs.classMember(definition, 'primary_sprite_factory');
				if (initialize?.expression.kind === LuaSyntaxKind.FunctionExpression && primary?.expression.kind === LuaSyntaxKind.FunctionExpression
					&& primary === constructor) producers.push({ kind: 'sprite', defaults: null, primary: true });
			}
			const components = fields.member(definition, 'components');
			if (components?.expression.kind === LuaSyntaxKind.TableConstructorExpression
				&& !this.reader.snapshot.symbolResolver.authoredSources.tableMutations().has(components.expression)
				&& components.expression.fields.every(field => field.kind === LuaTableFieldKind.Array)) {
				for (const field of components.expression.fields) {
					const source = this.reader.snapshot.symbolResolver.writtenSources.expression(components.file, field.value);
					const direct = getLuaModuleAliasTarget(components.file, source.value);
					const builtinNew = direct === null ? undefined
						: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(direct, SPRITE_NEW) ? SPRITE_COMPONENT
							: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(direct, MODEL_NEW) ? MODEL_COMPONENT : undefined;
					if (builtinNew !== undefined) {
						const module = this.reader.module(components.file, builtinNew.constructor.module), constructor = fields.member(module, 'new');
						if (constructor?.expression.kind === LuaSyntaxKind.FunctionExpression
							&& this.reader.callable(components.file, field.value) === constructor)
							producers.push({ kind: builtinNew.kind, defaults: null });
						continue;
					}
					const call = this.reader.call(components.file, field.value); if (call === undefined || call.expression.method !== null) continue;
					const file = this.reader.snapshot.getFileData(call.file)!, target = getLuaModuleAliasTarget(file, call.callee);
					const builtinFactory = target === null ? undefined
						: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, SPRITE_FACTORY) ? SPRITE_COMPONENT
							: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, MODEL_FACTORY) ? MODEL_COMPONENT : undefined;
					if (builtinFactory === undefined) continue;
					const module = this.reader.module(file, builtinFactory.constructor.module);
					const constructor = fields.member(module, 'new'), factory = fields.member(module, 'factory');
					if (constructor?.expression.kind !== LuaSyntaxKind.FunctionExpression || factory?.expression.kind !== LuaSyntaxKind.FunctionExpression
						|| this.reader.callable(file, call.expression.callee) !== factory) continue;
					const argument = call.expression.arguments[0], defaults = argument === undefined ? undefined : this.reader.expression(file, argument);
					if (defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
					if (builtinFactory.kind === 'model') {
						// Model factories resolve their default resource before any instance
						// instance exists. Unknown resource input cannot be projected.
						const model = fields.member(defaults, 'model_id'), scene = fields.member(defaults, 'scene_index');
						if (model == null || this.reader.stringValue(model.file, model.expression) === undefined
							|| scene === undefined || scene !== null && readLuaNumberExpression(scene.expression) === null) continue;
					}
					producers.push({ kind: builtinFactory.kind, defaults });
				}
			}
			this.producers.set(definition, producers);
		}
		return producers;
	}
}
