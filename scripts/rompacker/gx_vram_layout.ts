import {
	GX_GPU_VRAM_Y_ADDRESS_PERIOD,
	GX_GPU_VRAM_X_ADDRESS_PERIOD,
} from '../../machine/ts/spec/gx/vram';
import {
	GX_SYSTEM_VRAM_HEIGHT,
	GX_SYSTEM_VRAM_WIDTH,
	GX_SYSTEM_VRAM_X,
	GX_SYSTEM_VRAM_Y,
} from './system_texture';
import { GX_GPU_CLUT_4BIT_WORDS } from '../../machine/ts/spec/gx/gp0';
import { packLowHigh16 } from '../../machine/ts/machine/common/word';
import { GX_CART_TEXTURE_GROUP_ID_LIMIT, textureGroupResourceName } from './texture_atlas_contract';

export type GxTextureBuildMode = 'direct16' | 'palette4';

export type GxVramRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type GxTextureSlot = {
	texture: GxVramRect;
	clut?: GxVramRect;
};

export type GxTextureGroupLayout = {
	mode: GxTextureBuildMode;
	slots: string[];
	page_local: boolean;
};

export type GxVramLayout = {
	framebuffers: GxVramRect[];
	reserved: Record<string, GxVramRect>;
	slots: Record<string, GxTextureSlot>;
	groups: Record<string, GxTextureGroupLayout>;
	working_sets: Record<string, string[]>;
};

function rectsOverlap(left: GxVramRect, right: GxVramRect): boolean {
	return left.x < right.x + right.width
		&& right.x < left.x + left.width
		&& left.y < right.y + right.height
		&& right.y < left.y + left.height;
}

function assertVramRect(name: string, rect: GxVramRect): void {
	if (rect.width <= 0 || rect.height <= 0
		|| rect.x < 0 || rect.y < 0
		|| rect.x + rect.width > GX_GPU_VRAM_X_ADDRESS_PERIOD
		|| rect.y + rect.height > GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		throw new Error(`[RomPacker] GX VRAM rectangle '${name}' is outside ${GX_GPU_VRAM_X_ADDRESS_PERIOD}x${GX_GPU_VRAM_Y_ADDRESS_PERIOD} VRAM.`);
	}
}

function slotRects(slot: GxTextureSlot): GxVramRect[] {
	return slot.clut ? [slot.texture, slot.clut] : [slot.texture];
}

export function validateGxVramLayout(layout: GxVramLayout): void {
	const framebuffers = layout.framebuffers;
	if (framebuffers.length > 2) {
		throw new Error('[RomPacker] GX VRAM layout supports at most two display framebuffers.');
	}
	for (let index = 0; index < framebuffers.length; index += 1) {
		const framebuffer = framebuffers[index];
		assertVramRect(`framebuffers.${index}`, framebuffer);
		for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
			if (rectsOverlap(framebuffer, framebuffers[otherIndex])) {
				throw new Error(`[RomPacker] GX display framebuffers ${otherIndex} and ${index} overlap.`);
			}
		}
	}
	if (framebuffers.length === 2
		&& (framebuffers[0].width !== framebuffers[1].width || framebuffers[0].height !== framebuffers[1].height)) {
		throw new Error('[RomPacker] GX double-buffered display framebuffers must have identical dimensions.');
	}

	const reservedEntries = Object.entries(layout.reserved);
	const system = layout.reserved.system;
	if (!system
		|| system.x !== GX_SYSTEM_VRAM_X
		|| system.y !== GX_SYSTEM_VRAM_Y
		|| system.width !== GX_SYSTEM_VRAM_WIDTH
		|| system.height !== GX_SYSTEM_VRAM_HEIGHT) {
		throw new Error(`[RomPacker] GX reserved region 'system' must be ${GX_SYSTEM_VRAM_WIDTH}x${GX_SYSTEM_VRAM_HEIGHT} at (${GX_SYSTEM_VRAM_X},${GX_SYSTEM_VRAM_Y}).`);
	}
	for (let index = 0; index < reservedEntries.length; index += 1) {
		const [name, rect] = reservedEntries[index];
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			throw new Error(`[RomPacker] GX reserved region '${name}' is not a Lua identifier.`);
		}
		assertVramRect(`reserved.${name}`, rect);
		for (let framebufferIndex = 0; framebufferIndex < framebuffers.length; framebufferIndex += 1) {
			if (rectsOverlap(rect, framebuffers[framebufferIndex])) {
				throw new Error(`[RomPacker] GX reserved region '${name}' overlaps display framebuffer ${framebufferIndex}.`);
			}
		}
		for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
			const [otherName, otherRect] = reservedEntries[otherIndex];
			if (rectsOverlap(rect, otherRect)) {
				throw new Error(`[RomPacker] GX reserved regions '${otherName}' and '${name}' overlap.`);
			}
		}
	}
	for (const [slotName, slot] of Object.entries(layout.slots)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(slotName)) {
			throw new Error(`[RomPacker] GX slot '${slotName}' is not a Lua identifier.`);
		}
		const rects = slotRects(slot);
		for (let rectIndex = 0; rectIndex < rects.length; rectIndex += 1) {
			const rect = rects[rectIndex];
			assertVramRect(`slots.${slotName}.${rectIndex === 0 ? 'texture' : 'clut'}`, rect);
			for (let framebufferIndex = 0; framebufferIndex < framebuffers.length; framebufferIndex += 1) {
				if (rectsOverlap(rect, framebuffers[framebufferIndex])) {
					throw new Error(`[RomPacker] GX slot '${slotName}' overlaps display framebuffer ${framebufferIndex}.`);
				}
			}
			for (const [reservedName, reserved] of reservedEntries) {
				if (rectsOverlap(rect, reserved)) {
					throw new Error(`[RomPacker] GX slot '${slotName}' overlaps reserved region '${reservedName}'.`);
				}
			}
		}
		if (slot.clut && rectsOverlap(slot.texture, slot.clut)) {
			throw new Error(`[RomPacker] GX slot '${slotName}' overlaps its texture and CLUT rectangles.`);
		}
	}

	for (const [groupId, group] of Object.entries(layout.groups)) {
		if (!/^(0|[1-9][0-9]*)$/.test(groupId) || Number(groupId) >= GX_CART_TEXTURE_GROUP_ID_LIMIT) {
			throw new Error(`[RomPacker] GX texture group key '${groupId}' is not a cart texture group id below ${GX_CART_TEXTURE_GROUP_ID_LIMIT}.`);
		}
		if (group.mode !== 'direct16' && group.mode !== 'palette4') {
			throw new Error(`[RomPacker] GX texture group ${groupId} has unknown mode '${group.mode}'.`);
		}
		if (group.slots.length === 0) {
			throw new Error(`[RomPacker] GX texture group ${groupId} has no VRAM slots.`);
		}
		if (!group.page_local && group.mode !== 'direct16') {
			throw new Error(`[RomPacker] GX tiled texture group ${groupId} must use direct16 texture pages.`);
		}
		for (let slotIndex = 0; slotIndex < group.slots.length; slotIndex += 1) {
			const slotName = group.slots[slotIndex];
			const slot = layout.slots[slotName];
			if (!slot) {
				throw new Error(`[RomPacker] GX texture group ${groupId} references unknown slot '${slotName}'.`);
			}
			if (group.mode === 'palette4') {
				const clut = slot.clut;
				if (!clut) {
					throw new Error(`[RomPacker] GX palette4 texture group ${groupId} requires a CLUT rectangle in slot '${slotName}'.`);
				}
				if ((slot.texture.x & 0x3f) !== 0 || (clut.x & 0x0f) !== 0 || clut.width < GX_GPU_CLUT_4BIT_WORDS || clut.height < 1) {
					throw new Error(`[RomPacker] GX palette4 slot '${slotName}' is not aligned for a PSX texture page and 16-word CLUT.`);
				}
			}
			if (!group.page_local && ((slot.texture.x & 0xff) !== 0 || (slot.texture.y & 0xff) !== 0)) {
				throw new Error(`[RomPacker] GX tiled texture slot '${slotName}' must start on a texture-page boundary.`);
			}
		}
	}

	for (const [workingSetName, slotNames] of Object.entries(layout.working_sets)) {
		const occupied: Array<{ slotName: string; rect: GxVramRect }> = [];
		for (let slotIndex = 0; slotIndex < slotNames.length; slotIndex += 1) {
			const slotName = slotNames[slotIndex];
			const slot = layout.slots[slotName];
			if (!slot) {
				throw new Error(`[RomPacker] GX working set '${workingSetName}' references unknown slot '${slotName}'.`);
			}
			for (const rect of slotRects(slot)) {
				for (let occupiedIndex = 0; occupiedIndex < occupied.length; occupiedIndex += 1) {
					const other = occupied[occupiedIndex];
					if (rectsOverlap(rect, other.rect)) {
						throw new Error(`[RomPacker] GX working set '${workingSetName}' overlaps slots '${other.slotName}' and '${slotName}'.`);
					}
				}
				occupied.push({ slotName, rect });
			}
		}
	}
}

export function buildTextureBindingsModuleSource(layout: GxVramLayout): string {
	const pools = new Map<string, { name: string; words: number[]; index: number }>();
	const bindings: Array<{ textureId: string; poolIndex: number }> = [];
	const groupEntries = Object.entries(layout.groups).sort(([left], [right]) => Number(left) - Number(right));
	for (let groupIndex = 0; groupIndex < groupEntries.length; groupIndex += 1) {
		const [groupId, group] = groupEntries[groupIndex];
		const poolKey = JSON.stringify(group.slots);
		let pool = pools.get(poolKey);
		if (!pool) {
			const words: number[] = [];
			for (let slotIndex = 0; slotIndex < group.slots.length; slotIndex += 1) {
				const slot = layout.slots[group.slots[slotIndex]];
				words.push(
					packLowHigh16(slot.texture.x, slot.texture.y),
					slot.clut ? packLowHigh16(slot.clut.x, slot.clut.y) : 0,
				);
			}
			pool = {
				name: `placement_words_${pools.size + 1}`,
				words,
				index: pools.size + 1,
			};
			pools.set(poolKey, pool);
		}
		bindings.push({
			textureId: textureGroupResourceName(Number(groupId)),
			poolIndex: pool.index,
		});
	}

	const lines: string[] = [];
	for (const pool of pools.values()) {
		lines.push(`local ${pool.name}<const> = {`);
		for (let wordIndex = 0; wordIndex < pool.words.length; wordIndex += 2) {
			lines.push(`\t${pool.words[wordIndex]}, ${pool.words[wordIndex + 1]},`);
		}
		lines.push('}', '');
	}
	lines.push('local placement_pools<const> = {');
	for (const pool of pools.values()) {
		lines.push(`\t${pool.name},`);
	}
	lines.push('}', '', 'local pool_index_by_texture<const> = {');
	for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
		const binding = bindings[bindingIndex];
		lines.push(`\t${binding.textureId} = ${binding.poolIndex},`);
	}
	lines.push('}', '', 'return {', '\tplacement_pools = placement_pools,', '\tpool_index_by_texture = pool_index_by_texture,', '}', '');
	return lines.join('\n');
}

export function buildPresentationConfigModuleSource(layout: GxVramLayout): string {
	const displayPage = layout.framebuffers[0];
	const drawPage = layout.framebuffers[1] ?? displayPage;
	return [
		'module<const>',
		'',
		'return {',
		`\tdisplay_page = ${packLowHigh16(displayPage.x, displayPage.y)},`,
		`\tdraw_page = ${packLowHigh16(drawPage.x, drawPage.y)},`,
		`\tpage_size = ${packLowHigh16(displayPage.width, displayPage.height)},`,
		'}',
		'',
	].join('\n');
}
