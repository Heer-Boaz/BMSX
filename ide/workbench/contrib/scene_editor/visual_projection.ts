import { LuaSyntaxKind, LuaTableFieldKind, type LuaFunctionExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { FunctionValueFlowEntry } from '../../../../toolchain/ts/lua/semantic/value_graph';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import type { Affine2 } from '../../../common/affine2';
import type { Affine3 } from '../../../../machine/ts/common/affine3';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';
import { readSceneSourceAffine } from './authored_affine';
import type { SceneSourceAffine, SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';
import type { ScenePrefabSources } from './prefab_sources';
import type { SceneSpatialProjection } from './spatial_projection';
import type { SceneAddMemberChoice } from './member_insertion';

type SceneCanvasPlacement<Owner> = {
	readonly entry: Owner;
	/** Borrowed admitted spatial pose; visual placement never rewrites it. */
	readonly world: Readonly<Affine2>;
	readonly attachment: Readonly<Affine2>;
	readonly presentation: Readonly<Affine2>;
	/** Opaque host color: ordinary canvas packets consume the authored RGB only. */
	readonly color: number;
	readonly order: number;
};
export type SceneSpriteSource<Owner = SceneSourceObject> = SceneCanvasPlacement<Owner> & {
	readonly kind: 'sprite';
	readonly image: string;
	readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly flipH: boolean;
	readonly flipV: boolean;
};
export type SceneRectangleSource<Owner = SceneSourceObject> = SceneCanvasPlacement<Owner> & {
	readonly kind: 'rectangle';
	readonly width: number;
	readonly height: number;
};
export type SceneCanvasSource<Owner = SceneSourceObject> = SceneSpriteSource<Owner> | SceneRectangleSource<Owner>;
export type SceneModelSource<Owner = SceneSourceObject> = {
	readonly entry: Owner;
	readonly model: string;
	/** Proved absent selects the model asset's declared default scene. */
	readonly sceneIndex?: number;
	/** Borrowed admitted spatial pose; attachment and presentation keep their append order. */
	readonly world: Readonly<Affine3>;
	readonly attachment: Readonly<Affine3>;
	readonly presentation: Readonly<Affine3>;
};
/** Declared constructor inputs, not a guest instance or a gameplay-time frame. */
export type SceneVisualReadModel<Owner = SceneSourceObject> = {
	readonly canvas: readonly SceneCanvasSource<Owner>[];
	readonly models: readonly SceneModelSource<Owner>[];
};
/** The same constructor inputs as an appended root member, before any source occurrence exists. */
export type ScenePrefabPreview = {
	readonly world: Readonly<Affine2>;
	readonly visuals: SceneVisualReadModel<SceneAddMemberChoice>;
};
type SourceState = LuaWrittenExpression | null | undefined;
type ComponentProducer = { readonly kind: 'sprite' | 'rectangle' | 'model'; readonly defaults: SourceState;
	readonly input: 'primary' | 'owner' | 'configuration' };
const SPRITE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['new'] };
const SPRITE_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['factory'] };
const MODEL_NEW: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['new'] };
const MODEL_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['factory'] };
const RECTANGLE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/rectangle_component', memberPath: ['new'] };
const SPRITE_OBJECT: LuaModuleImportTarget = { module: 'cartlib/sprite', memberPath: [] };
const SPRITE_COMPONENT = { kind: 'sprite' as const, constructor: SPRITE_NEW };
const MODEL_COMPONENT = { kind: 'model' as const, constructor: MODEL_NEW };
const RECTANGLE_COMPONENT = { kind: 'rectangle' as const, constructor: RECTANGLE_NEW };
const IDENTITY_2D: SceneSourceAffine = { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
const IDENTITY_3D: SceneSourceAffine = { family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };

/** Resolves concrete constructor configuration using the producer's nil-only
 * and `or` default rules. Unknown writes never grant defaults. */
class ComponentConstructorInputs {
	public constructor(private readonly reader: LuaSourceReader, private readonly input: SourceState,
		private readonly defaults: SourceState, private readonly classes: readonly LuaWrittenExpression[] | null | undefined) {}
	public member(source: SourceState, name: string): SourceState {
		if (source === undefined || source === null) return source;
		if (source.expression.kind === LuaSyntaxKind.NilLiteralExpression) return null;
		const value = this.reader.memberState(source.file, source.expression, name);
		return value?.expression.kind === LuaSyntaxKind.NilLiteralExpression ? null : value;
	}
	public configuredValue(name: string): SourceState {
		const input = this.member(this.input, name);
		return input === null ? this.member(this.defaults, name) : input;
	}
	public value(name: string): SourceState {
		const value = this.configuredValue(name);
		if (value !== null) return value;
		if (this.classes === undefined) return;
		if (this.classes === null) return null;
		for (const source of this.classes) {
			const inherited = this.reader.ownMemberState(source.file, source.expression, name);
			if (inherited === undefined) return;
			if (inherited !== null && inherited.expression.kind !== LuaSyntaxKind.NilLiteralExpression) return inherited;
		}
		return null;
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
	private readonly previews = new WeakMap<SceneAddMemberChoice, ScenePrefabPreview | undefined>();
	private readonly producers = new WeakMap<LuaWrittenExpression, ComponentProducer[]>();
	private readonly forwarding = new WeakMap<LuaWrittenExpression, ComponentProducer | undefined>();
	private readonly functionFlows = new WeakMap<FileSemanticData, ReadonlyMap<LuaFunctionExpression, FunctionValueFlowEntry>>();
	private readonly reader: LuaSourceReader;
	private readonly fields: ComponentConstructorInputs;
	public constructor(private readonly prefabs: ScenePrefabSources, private readonly spatial: SceneSpatialProjection) {
		this.reader = prefabs.reader; this.fields = new ComponentConstructorInputs(this.reader, null, null, null);
	}
	public readScene(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneVisualReadModel {
		const retained = this.scenes.get(scene); if (retained !== undefined) return retained;
		const canvas: SceneCanvasSource[] = [], models: SceneModelSource[] = [];
		const reader = this.reader, fields = this.fields, spatial = this.spatial.readScene(document, scene);
		for (const entry of spatial.constructionOrder) {
			const world = spatial.worlds.get(entry); if (world === undefined) continue;
			const member = reader.expression(document.analysis, entry.field.value)!;
			const definitionSource = reader.member(member.file, member.expression, 'definition_id');
			const id = definitionSource === undefined ? undefined : reader.stringValue(definitionSource.file, definitionSource.expression);
			const definition = id === undefined ? undefined : this.prefabs.all.get(id); if (definition === undefined) continue;
			this.appendVisuals(canvas, models, entry, definition, fields.member(member, 'options'), world);
		}
		// Stable host sort preserves the already admitted fresh-instance sequence.
		canvas.sort((a, b) => a.order - b.order);
		const result = { canvas, models }; this.scenes.set(scene, result); return result;
	}
	/** Resolve once per selected prefab in this immutable source generation. Its
	 * position is supplied by insertion, while the inherited linear basis remains. */
	public readPrefabPreview(choice: SceneAddMemberChoice): ScenePrefabPreview | undefined {
		if (!this.previews.has(choice)) {
			const definition = this.prefabs.all.get(choice.id), pose = this.spatial.prefabTransform(choice.id);
			let preview: ScenePrefabPreview | undefined;
			if (definition !== undefined && pose?.family === '2d') {
				const world = { ...pose, ox: 0, oy: 0 };
				const canvas: SceneCanvasSource<SceneAddMemberChoice>[] = [], models: SceneModelSource<SceneAddMemberChoice>[] = [];
				this.appendVisuals(canvas, models, choice, definition, null, world);
				canvas.sort((a, b) => a.order - b.order);
				preview = { world, visuals: { canvas, models } };
			}
			this.previews.set(choice, preview);
		}
		return this.previews.get(choice);
	}

	private appendVisuals<Owner>(canvas: SceneCanvasSource<Owner>[], models: SceneModelSource<Owner>[],
		entry: Owner, definition: LuaWrittenExpression, options: SourceState, world: Readonly<SceneSourceAffine>): void {
		const reader = this.reader, fields = this.fields, defaults = fields.member(definition, 'defaults');
		const ownerInputs = new ComponentConstructorInputs(reader, readLuaSourceTruth(options) === false ? null : options,
			readLuaSourceTruth(defaults) === false ? null : defaults, this.prefabs.classes(definition));
		const ownerVisible = ownerInputs.value('visible');
		if (ownerVisible !== null && readLuaSourceTruth(ownerVisible) !== true) return;
		for (const producer of this.readProducers(definition)) {
			if ((producer.kind !== 'model') !== (world.family === '2d')) continue;
			const primary = producer.input === 'primary';
			if (primary && ownerInputs.configuredValue('primary_sprite_factory') !== null) continue;
			const inputs = producer.input === 'configuration' ? new ComponentConstructorInputs(reader, null, producer.defaults, null) : ownerInputs;
			if (!primary && (inputs.flag('enabled', true) !== true || inputs.flag('visible', true) !== true)) continue;
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
			const order = inputs.number('order', 0), presentationOrder = inputs.number('presentation_order', 0);
			if (order == null || presentationOrder == null) continue;
			if (producer.kind === 'rectangle') {
				const widthSource = inputs.value('width'), heightSource = inputs.value('height'), colorSource = inputs.value('color');
				if (widthSource == null || heightSource == null || colorSource == null) continue;
				const width = readLuaNumberExpression(widthSource.expression), height = readLuaNumberExpression(heightSource.expression);
				const color = readLuaNumberExpression(colorSource.expression);
				if (width === null || height === null || color === null) continue;
				canvas.push({ kind: 'rectangle', entry, width, height, world, attachment, presentation,
					color: (color | 0xff000000) >>> 0, order: order + presentationOrder });
				continue;
			}
			const imageSource = inputs.value('imgid');
			const image = imageSource === undefined || imageSource === null ? undefined : reader.stringValue(imageSource.file, imageSource.expression);
			if (image === undefined) continue;
			const color = inputs.number('color', 0xffffffff), flipH = inputs.flag('flip_h', false), flipV = inputs.flag('flip_v', false);
			if (color == null || flipH === undefined || flipV === undefined) continue;
			let regionSource = inputs.value('region');
			if (primary && readLuaSourceTruth(regionSource) === false) regionSource = null;
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
			canvas.push({ kind: 'sprite', entry, image, world, attachment, presentation, region, color: (color | 0xff000000) >>> 0, flipH, flipV, order: order + presentationOrder });
		}
	}

	private affine(source: SourceState, family: '2d' | '3d'): Readonly<SceneSourceAffine> | undefined {
		if (readLuaSourceTruth(source) === false) return family === '2d' ? IDENTITY_2D : IDENTITY_3D;
		if (source === undefined || source === null) return;
		const affine = readSceneSourceAffine(this.reader, source.file, source.expression);
		return affine?.family === family ? affine : undefined;
	}
	private builtinConstructor(source: LuaWrittenExpression) {
		const target = getLuaModuleAliasTarget(source.file, source.value);
		if (target === null) return;
		const imports = this.reader.snapshot.symbolResolver.moduleImports;
		const component = imports.matchesImport(target, SPRITE_NEW) ? SPRITE_COMPONENT
			: imports.matchesImport(target, MODEL_NEW) ? MODEL_COMPONENT
				: imports.matchesImport(target, RECTANGLE_NEW) ? RECTANGLE_COMPONENT : undefined;
		if (component === undefined) return;
		const module = this.reader.module(source.file, component.constructor.module), constructor = this.fields.member(module, 'new');
		if (constructor?.expression.kind === LuaSyntaxKind.FunctionExpression
			&& this.reader.callable(source.file, source.expression) === constructor) return component;
	}
	/** A component adapter is admitted only as a single direct constructor return.
	 * Binder identities prove its owner argument; no body or arbitrary call is evaluated. */
	private forwardingProducer(source: LuaWrittenExpression): ComponentProducer | undefined {
		const callable = this.reader.callable(source.file, source.expression);
		if (callable?.expression.kind !== LuaSyntaxKind.FunctionExpression) return;
		if (this.forwarding.has(callable)) return this.forwarding.get(callable);
		this.forwarding.set(callable, undefined);
		const { expression, file } = callable;
		if (expression.hasVararg || expression.parameters.length !== 1 || expression.body.body.length !== 1) return;
		const statement = expression.body.body.get(0);
		if (statement.kind !== LuaSyntaxKind.ReturnStatement || statement.expressions.length !== 1) return;
		const call = this.reader.call(file, statement.expressions[0]);
		if (call === undefined || call.expression.method !== null || call.expression.arguments.length > 3) return;
		let flows = this.functionFlows.get(file);
		if (flows === undefined) {
			flows = new Map(file.functionValueFlows.map(flow => [flow.expression, flow]));
			this.functionFlows.set(file, flows);
		}
		const flow = flows.get(expression);
		if (flow?.calls.length !== 1 || flow.calls[0] !== call) return;
		const query = this.reader.snapshot.symbolResolver.writtenSources;
		const component = this.builtinConstructor(query.expression(file, call.expression.callee));
		if (component === undefined) return;
		const owner = file.declarationIdsBySyntax.get(expression.parameters[0]);
		const args = call.arguments, first = args[0], configuration = args[1];
		if (first?.root.kind !== 'declaration' || first.root.declId !== owner || first.steps.length !== 0) return;
		const id = call.expression.arguments[2];
		if (id !== undefined) {
			const source = this.reader.expression(file, id);
			if (source?.expression.kind !== LuaSyntaxKind.NilLiteralExpression
				&& this.reader.stringValue(file, id) === undefined) return;
		}
		let defaults: SourceState = null, input: ComponentProducer['input'] = 'configuration';
		if (configuration?.root.kind === 'declaration' && configuration.root.declId === owner && configuration.steps.length === 0) input = 'owner';
		else {
			const argument = call.expression.arguments[1];
			defaults = argument === undefined ? null : this.reader.expression(file, argument);
			if (defaults?.expression.kind === LuaSyntaxKind.NilLiteralExpression) defaults = null;
			if (defaults !== null && (defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
				|| this.reader.snapshot.symbolResolver.authoredSources.tableMutations().has(defaults.expression))) return;
		}
		const producer = { kind: component.kind, defaults, input };
		this.forwarding.set(callable, producer); return producer;
	}
	private readProducers(definition: LuaWrittenExpression): readonly ComponentProducer[] {
		let producers = this.producers.get(definition);
		if (producers === undefined) {
			producers = [];
			const fields = this.fields;
			const initialize = this.prefabs.classMember(definition, 'initialize');
			const sprite = this.reader.module(definition.file, SPRITE_OBJECT.module);
			if (sprite !== undefined && this.prefabs.classes(definition)?.includes(sprite)) {
				const componentModule = this.reader.module(definition.file, SPRITE_NEW.module), constructor = fields.member(componentModule, 'new');
				const primary = this.prefabs.classMember(definition, 'primary_sprite_factory');
				if (initialize?.expression.kind === LuaSyntaxKind.FunctionExpression && primary?.expression.kind === LuaSyntaxKind.FunctionExpression
					&& primary === constructor) producers.push({ kind: 'sprite', defaults: null, input: 'primary' });
			}
			const components = fields.member(definition, 'components');
			if (components?.expression.kind === LuaSyntaxKind.TableConstructorExpression
				&& !this.reader.snapshot.symbolResolver.authoredSources.tableMutations().has(components.expression)
				&& components.expression.fields.every(field => field.kind === LuaTableFieldKind.Array)) {
				// Owner inputs describe the shell only until an initializer or an
				// unproved earlier factory can write it. Concrete profiles stay separate.
				let ownerUnchanged = initialize === null;
				for (const field of components.expression.fields) {
					const source = this.reader.snapshot.symbolResolver.writtenSources.expression(components.file, field.value);
					const builtinNew = this.builtinConstructor(source);
					if (builtinNew !== undefined) {
						producers.push({ kind: builtinNew.kind, defaults: null, input: 'configuration' });
						continue;
					}
					const forwarding = this.forwardingProducer(source);
					if (forwarding !== undefined) {
						if (forwarding.input !== 'owner' || ownerUnchanged) producers.push(forwarding);
						continue;
					}
					const call = this.reader.call(components.file, field.value);
					if (call === undefined || call.expression.method !== null) { ownerUnchanged = false; continue; }
					const file = this.reader.snapshot.getFileData(call.file)!, target = getLuaModuleAliasTarget(file, call.callee);
					const builtinFactory = target === null ? undefined
						: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, SPRITE_FACTORY) ? SPRITE_COMPONENT
							: this.reader.snapshot.symbolResolver.moduleImports.matchesImport(target, MODEL_FACTORY) ? MODEL_COMPONENT : undefined;
					if (builtinFactory === undefined) { ownerUnchanged = false; continue; }
					const module = this.reader.module(file, builtinFactory.constructor.module);
					const constructor = fields.member(module, 'new'), factory = fields.member(module, 'factory');
					if (constructor?.expression.kind !== LuaSyntaxKind.FunctionExpression || factory?.expression.kind !== LuaSyntaxKind.FunctionExpression
						|| this.reader.callable(file, call.expression.callee) !== factory) { ownerUnchanged = false; continue; }
					const argument = call.expression.arguments[0], defaults = argument === undefined ? undefined : this.reader.expression(file, argument);
					if (defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) { ownerUnchanged = false; continue; }
					if (builtinFactory.kind === 'model') {
						// Model factories resolve their default resource before any instance
						// instance exists. Unknown resource input cannot be projected.
						const model = fields.member(defaults, 'model_id'), scene = fields.member(defaults, 'scene_index');
						if (model == null || this.reader.stringValue(model.file, model.expression) === undefined
							|| scene === undefined || scene !== null && readLuaNumberExpression(scene.expression) === null) { ownerUnchanged = false; continue; }
					}
					producers.push({ kind: builtinFactory.kind, defaults, input: 'configuration' });
				}
			}
			this.producers.set(definition, producers);
		}
		return producers;
	}
}
