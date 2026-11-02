import { readSceneConstructorNumber, SceneConstructorInputs, type SceneConstructorSource } from './constructor_inputs';
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
import { SceneFontSources } from './font_sources';
import { readSceneTextInputs, type SceneTextInputs } from './text_source';
import { SceneSpriteAnimationSources, type SceneSpriteAnimationSource } from './sprite_animation_source';
import { readSceneSpriteInputs } from './sprite_source';
import { isSceneSpriteInitializer } from './sprite_initialization';

type SceneCanvasPlacement<Owner> = {
	readonly entry: Owner;
	/** Borrowed admitted spatial pose; visual placement never rewrites it. */
	readonly world: Readonly<Affine2>;
	readonly attachment: Readonly<Affine2>;
	readonly presentation: Readonly<Affine2>;
	/** Color word; the viewport chooses preview opacity at the render boundary. */
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
export type SceneTextSource<Owner = SceneSourceObject> = SceneCanvasPlacement<Owner> & SceneTextInputs & { readonly kind: 'text' };
export type SceneCanvasSource<Owner = SceneSourceObject> = SceneSpriteSource<Owner> | SceneRectangleSource<Owner> | SceneTextSource<Owner>;
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
	readonly world: Readonly<SceneSourceAffine>;
	readonly visuals: SceneVisualReadModel<SceneAddMemberChoice>;
};
type ComponentProducer = { readonly kind: 'sprite' | 'surface' | 'rectangle' | 'model' | 'text'; readonly defaults: SceneConstructorSource;
	readonly input: 'primary' | 'owner' | 'configuration' | 'factory'; readonly animation?: SceneSpriteAnimationSource };
const SPRITE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['new'] };
const SPRITE_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/sprite_component', memberPath: ['factory'] };
const SURFACE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/surface_component', memberPath: ['new'] };
const MODEL_NEW: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['new'] };
const MODEL_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/static_model_component', memberPath: ['factory'] };
const RECTANGLE_NEW: LuaModuleImportTarget = { module: 'cartlib/component/rectangle_component', memberPath: ['new'] };
const TEXT_NEW: LuaModuleImportTarget = { module: 'cartlib/text/text_component', memberPath: ['new'] };
const TEXT_FACTORY: LuaModuleImportTarget = { module: 'cartlib/text/text_component', memberPath: ['factory'] };
const SPRITE_ANIMATION_FACTORY: LuaModuleImportTarget = { module: 'cartlib/component/sprite_animation_component', memberPath: ['factory'] };
const SPRITE_OBJECT: LuaModuleImportTarget = { module: 'cartlib/sprite', memberPath: [] };
const SPRITE_COMPONENT = { kind: 'sprite' as const, constructor: SPRITE_NEW };
const SURFACE_COMPONENT = { kind: 'surface' as const, constructor: SURFACE_NEW };
const MODEL_COMPONENT = { kind: 'model' as const, constructor: MODEL_NEW };
const RECTANGLE_COMPONENT = { kind: 'rectangle' as const, constructor: RECTANGLE_NEW };
const TEXT_COMPONENT = { kind: 'text' as const, constructor: TEXT_NEW };
const FACTORIES = [
	{ api: SPRITE_FACTORY, component: SPRITE_COMPONENT, animated: false },
	{ api: MODEL_FACTORY, component: MODEL_COMPONENT, animated: false },
	{ api: TEXT_FACTORY, component: TEXT_COMPONENT, animated: false },
	{ api: SPRITE_ANIMATION_FACTORY, component: SPRITE_COMPONENT, animated: true },
] as const;
const PRIMARY_SPRITE: ComponentProducer = { kind: 'sprite', defaults: null, input: 'primary' };
const SPRITE_AFFINES = ['attachment_affine', 'presentation_affine'] as const;
const IDENTITY_2D: SceneSourceAffine = { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
const IDENTITY_3D: SceneSourceAffine = { family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };

/** Retained source generation and exact source occurrences. It borrows the
 * spatial owner's poses/order and does no asset lookup, Lua execution or paint. */
export class SceneVisualProjection {
	private readonly scenes = new WeakMap<SceneSourceDefinition, SceneVisualReadModel>();
	private readonly previews = new WeakMap<SceneAddMemberChoice, ScenePrefabPreview | undefined>();
	private readonly producers = new WeakMap<LuaWrittenExpression, ComponentProducer[]>();
	private readonly forwarding = new WeakMap<LuaWrittenExpression, ComponentProducer | undefined>();
	private readonly functionFlows = new WeakMap<FileSemanticData, ReadonlyMap<LuaFunctionExpression, FunctionValueFlowEntry>>();
	private readonly reader: LuaSourceReader;
	private readonly fields: SceneConstructorInputs;
	private readonly fonts: SceneFontSources;
	private readonly animations: SceneSpriteAnimationSources;
	private readonly factories = new WeakMap<LuaWrittenExpression, ComponentProducer | undefined>();
	public constructor(private readonly prefabs: ScenePrefabSources, private readonly spatial: SceneSpatialProjection) {
		this.reader = prefabs.reader; this.fields = new SceneConstructorInputs(this.reader, null, null, null);
		this.fonts = new SceneFontSources(this.reader);
		this.animations = new SceneSpriteAnimationSources(this.reader);
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
			if (definition !== undefined && pose !== undefined) {
				const world = pose.family === '2d' ? { ...pose, ox: 0, oy: 0 } : { ...pose, ox: 0, oy: 0, oz: 0 };
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
		entry: Owner, definition: LuaWrittenExpression, options: SceneConstructorSource, world: Readonly<SceneSourceAffine>): void {
		const reader = this.reader, fields = this.fields, defaults = fields.member(definition, 'defaults');
		if (defaults !== null && defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
		const ownerInputs = new SceneConstructorInputs(reader, readLuaSourceTruth(options) === false ? null : options,
			defaults, this.prefabs.classes(definition));
		const ownerVisible = ownerInputs.value('visible');
		if (ownerVisible !== null && readLuaSourceTruth(ownerVisible) !== true) return;
		for (const declared of this.readProducers(definition)) {
			const primary = declared.input === 'primary';
			const producer = primary ? this.primaryProducer(ownerInputs.value('primary_sprite_factory')) : declared;
			if (producer === undefined) continue;
			if ((producer.kind !== 'model') !== (world.family === '2d')) continue;
			let inputs: SceneConstructorInputs;
			if (primary || producer.input === 'factory') inputs = new SceneConstructorInputs(reader, null, producer.defaults, null);
			else if (producer.input === 'configuration') inputs = new SceneConstructorInputs(reader, producer.defaults, null, null);
			else inputs = ownerInputs;
			if (inputs.flag('enabled', true) !== true || inputs.flag('visible', true) !== true) continue;
			const sprite = producer.kind === 'sprite' ? readSceneSpriteInputs(reader, inputs, primary ? ownerInputs : undefined, producer.animation) : undefined;
			if (producer.kind === 'sprite' && sprite === undefined) continue;
			const attachment = this.affine(sprite === undefined ? inputs.value('attachment_affine') : sprite.attachment, world.family);
			const presentation = this.affine(sprite === undefined ? inputs.value('presentation_affine') : sprite.presentation, world.family);
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
			if (sprite !== undefined) {
				canvas.push({ ...sprite, kind: 'sprite', entry, world, attachment, presentation });
				continue;
			}
			const order = readSceneConstructorNumber(inputs.value('order'), 0);
			const presentationOrder = readSceneConstructorNumber(inputs.value('presentation_order'), 0);
			if (order == null || presentationOrder == null) continue;
			const combinedOrder = order + presentationOrder;
			if (producer.kind === 'surface') {
				const imageSource = inputs.value('imgid');
				const image = imageSource == null ? undefined : reader.stringValue(imageSource.file, imageSource.expression);
				const color = readSceneConstructorNumber(inputs.value('color'), 0xffffffff);
				if (image === undefined || color == null) continue;
				canvas.push({ kind: 'sprite', entry, image, world, attachment, presentation, flipH: false, flipV: false,
					color, order: combinedOrder });
				continue;
			}
			if (producer.kind === 'text') {
				const text = readSceneTextInputs(reader, this.fonts, inputs, definition.file), color = inputs.optionalNumber('color');
				if (text === undefined || color === null) continue;
				canvas.push({ kind: 'text', entry, world, attachment, presentation, ...text,
					color: ((color === undefined ? 0xffffffff : color) | 0xff000000) >>> 0, order: combinedOrder });
				continue;
			}
			if (producer.kind === 'rectangle') {
				const widthSource = inputs.value('width'), heightSource = inputs.value('height'), colorSource = inputs.value('color');
				if (widthSource == null || heightSource == null || colorSource == null) continue;
				const width = readLuaNumberExpression(widthSource.expression), height = readLuaNumberExpression(heightSource.expression);
				const color = readLuaNumberExpression(colorSource.expression);
				if (width === null || height === null || color === null) continue;
				canvas.push({ kind: 'rectangle', entry, width, height, world, attachment, presentation,
					color: (color | 0xff000000) >>> 0, order: combinedOrder });
				continue;
			}
		}
	}

	private affine(source: SceneConstructorSource, family: '2d' | '3d'): Readonly<SceneSourceAffine> | undefined {
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
			: imports.matchesImport(target, SURFACE_NEW) ? SURFACE_COMPONENT
			: imports.matchesImport(target, MODEL_NEW) ? MODEL_COMPONENT
				: imports.matchesImport(target, RECTANGLE_NEW) ? RECTANGLE_COMPONENT
					: imports.matchesImport(target, TEXT_NEW) ? TEXT_COMPONENT : undefined;
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
		let defaults: SceneConstructorSource = null, input: ComponentProducer['input'] = 'configuration';
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
	/** The effective owner property chooses the primary constructor. A class,
	 * prefab default or instance override must name the actual builtin producer. */
	private primaryProducer(source: SceneConstructorSource): ComponentProducer | undefined {
		if (source == null) return;
		if (source.expression.kind === LuaSyntaxKind.FunctionExpression) {
			const module = this.reader.module(source.file, SPRITE_NEW.module);
			if (source === this.fields.member(module, 'new')) return PRIMARY_SPRITE;
		}
		const factory = this.factoryProducer(source);
		return factory?.kind === 'sprite' ? factory : undefined;
	}
	private factoryProducer(source: LuaWrittenExpression): ComponentProducer | undefined {
		if (this.factories.has(source)) return this.factories.get(source);
		this.factories.set(source, undefined);
		const reader = this.reader, fields = this.fields, call = reader.call(source.file, source.expression);
		if (call === undefined || call.expression.method !== null) return;
		const file = reader.snapshot.getFileData(call.file)!, target = getLuaModuleAliasTarget(file, call.callee);
		if (target === null) return;
		for (const binding of FACTORIES) {
			if (!reader.snapshot.symbolResolver.moduleImports.matchesImport(target, binding.api)) continue;
			const factoryModule = reader.module(file, binding.api.module), factory = fields.member(factoryModule, 'factory');
			const componentModule = binding.api.module === binding.component.constructor.module ? factoryModule : reader.module(file, binding.component.constructor.module);
			const constructor = fields.member(componentModule, 'new');
			if (constructor?.expression.kind !== LuaSyntaxKind.FunctionExpression || factory?.expression.kind !== LuaSyntaxKind.FunctionExpression
				|| reader.callable(file, call.expression.callee) !== factory) return;
			const argument = call.expression.arguments[0], defaults = argument === undefined ? undefined : reader.expression(file, argument);
			if (defaults?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
			if (binding.component.kind === 'model') {
				// Captured resource admission precedes every instance.
				const model = fields.member(defaults, 'model_id', 'raw'), scene = fields.member(defaults, 'scene_index', 'raw');
				if (model == null || reader.stringValue(model.file, model.expression) === undefined
					|| scene === undefined || scene !== null && readLuaNumberExpression(scene.expression) === null) return;
			}
			if (binding.component.kind === 'sprite') {
				const image = fields.member(defaults, 'imgid', 'raw');
				if (readLuaSourceTruth(image) !== false && (image == null || reader.stringValue(image.file, image.expression) === undefined)) return;
				// These table receivers are indexed during component construction,
				// before Sprite.initialize may apply an owner's later setters.
				const region = fields.member(defaults, 'region', 'raw');
				if (region !== null && region?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
				for (const name of SPRITE_AFFINES) {
					const affine = fields.member(defaults, name, 'raw');
					if (readLuaSourceTruth(affine) !== false && affine?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
				}
			}
			const animation = binding.animated ? this.animations.read(defaults) : undefined;
			if (binding.animated && animation === undefined) return;
			const producer: ComponentProducer = { kind: binding.component.kind, defaults, input: 'factory', animation };
			this.factories.set(source, producer); return producer;
		}
	}
	private readProducers(definition: LuaWrittenExpression): readonly ComponentProducer[] {
		let producers = this.producers.get(definition);
		if (producers === undefined) {
			producers = [];
			const fields = this.fields;
			const initialize = this.prefabs.classMember(definition, 'initialize');
			const sprite = this.reader.module(definition.file, SPRITE_OBJECT.module);
			if (sprite !== undefined && this.prefabs.classes(definition)?.includes(sprite)) {
				const spriteInitialize = fields.member(sprite, 'initialize');
				if (isSceneSpriteInitializer(this.reader, initialize, spriteInitialize)) producers.push(PRIMARY_SPRITE);
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
					const factory = this.factoryProducer(source);
					if (factory === undefined) { ownerUnchanged = false; continue; }
					producers.push(factory);
				}
			}
			this.producers.set(definition, producers);
		}
		return producers;
	}
}
