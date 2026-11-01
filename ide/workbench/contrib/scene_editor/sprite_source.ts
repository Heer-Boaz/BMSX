import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';
import { readSceneConstructorNumber, type SceneConstructorInputs, type SceneConstructorSource } from './constructor_inputs';
import type { SceneSpriteAnimationSource } from './sprite_animation_source';

/** Component construction precedes Sprite.initialize's owner overrides. Only
 * region/affine overrides use truthiness; color/order/flips use nil-only writes. */
function selectSpriteInput(inputs: SceneConstructorInputs, owner: SceneConstructorInputs | undefined,
	name: string, rule: 'nil' | 'truthy' = 'nil'): SceneConstructorSource {
	if (owner !== undefined) {
		const value = owner.value(name);
		if (value === undefined) return;
		const selected = rule === 'nil' ? value !== null : readLuaSourceTruth(value);
		if (selected === undefined) return;
		if (selected) return value;
	}
	return inputs.value(name);
}

/** Initial sprite inputs shared by explicit components and the primary Sprite
 * composition. The animation factory's own initial selection is already proved. */
export function readSceneSpriteInputs(reader: LuaSourceReader, inputs: SceneConstructorInputs,
	owner?: SceneConstructorInputs, animation?: SceneSpriteAnimationSource) {
	let image: string | undefined;
	if (animation !== undefined) {
		image = animation.initial;
		if (owner !== undefined && animation.named !== undefined) {
			const selection = owner.value('animation');
			if (selection === undefined) return;
			if (selection !== null) {
				const name = reader.stringValue(selection.file, selection.expression);
				image = name === undefined ? undefined : animation.named.get(name);
			}
		}
	} else {
		const source = selectSpriteInput(inputs, owner, 'imgid');
		image = source == null ? undefined : reader.stringValue(source.file, source.expression);
	}
	if (image === undefined) return;
	const color = readSceneConstructorNumber(selectSpriteInput(inputs, owner, 'color'), 0xffffffff);
	const order = readSceneConstructorNumber(selectSpriteInput(inputs, owner, 'order'), 0);
	const presentationOrder = readSceneConstructorNumber(selectSpriteInput(inputs, owner, 'presentation_order'), 0);
	const flipH = readLuaSourceTruth(selectSpriteInput(inputs, owner, 'flip_h')), flipV = readLuaSourceTruth(selectSpriteInput(inputs, owner, 'flip_v'));
	if (color == null || order == null || presentationOrder == null || flipH === undefined || flipV === undefined) return;
	const regionSource = selectSpriteInput(inputs, owner, 'region', 'truthy');
	let region: { x: number; y: number; width: number; height: number } | undefined;
	if (regionSource === undefined) return;
	if (regionSource !== null) {
		const x = inputs.member(regionSource, 'x'), y = inputs.member(regionSource, 'y');
		const width = inputs.member(regionSource, 'width'), height = inputs.member(regionSource, 'height');
		if (x == null || y == null || width == null || height == null) return;
		const nx = readLuaNumberExpression(x.expression), ny = readLuaNumberExpression(y.expression);
		const nw = readLuaNumberExpression(width.expression), nh = readLuaNumberExpression(height.expression);
		if (nx === null || ny === null || nw === null || nh === null) return;
		region = { x: nx, y: ny, width: nw, height: nh };
	}
	return { image, color: (color | 0xff000000) >>> 0, order: order + presentationOrder, flipH, flipV, region,
		attachment: selectSpriteInput(inputs, owner, 'attachment_affine', 'truthy'),
		presentation: selectSpriteInput(inputs, owner, 'presentation_affine', 'truthy') };
}
