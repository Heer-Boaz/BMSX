import {
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
} from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { GX_PALETTE4_CLUT_WORDS } from './gx_texture';
import { GX_CART_TEXTURE_GROUP_ID_LIMIT } from './texture_atlas_contract';

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

export type GxTextureLayout = {
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
		|| rect.x + rect.width > GX_GPU_VRAM_WIDTH
		|| rect.y + rect.height > GX_GPU_VRAM_HEIGHT) {
		throw new Error(`[RomPacker] GX VRAM rectangle '${name}' is outside ${GX_GPU_VRAM_WIDTH}x${GX_GPU_VRAM_HEIGHT} VRAM.`);
	}
}

function slotRects(slot: GxTextureSlot): GxVramRect[] {
	return slot.clut ? [slot.texture, slot.clut] : [slot.texture];
}

export function validateGxTextureLayout(layout: GxTextureLayout): void {
	const reservedEntries = Object.entries(layout.reserved);
	for (let index = 0; index < reservedEntries.length; index += 1) {
		const [name, rect] = reservedEntries[index];
		assertVramRect(`reserved.${name}`, rect);
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
				if ((slot.texture.x & 0x3f) !== 0 || (clut.x & 0x0f) !== 0 || clut.width < GX_PALETTE4_CLUT_WORDS || clut.height < 1) {
					throw new Error(`[RomPacker] GX palette4 slot '${slotName}' is not aligned for a PSX texture page and 16-word CLUT.`);
				}
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

export function buildGxTextureLayoutModuleSource(layout: GxTextureLayout): string {
	const declarations: string[] = [];
	const exports: string[] = [];
	const slotEntries = Object.entries(layout.slots).sort(([left], [right]) => left.localeCompare(right));
	for (let index = 0; index < slotEntries.length; index += 1) {
		const [name, slot] = slotEntries[index];
		const texture = slot.texture;
		declarations.push(`local ${name}<const> = ${(texture.x | (texture.y << 16)) >>> 0}`);
		exports.push(name);
		if (slot.clut) {
			declarations.push(`local ${name}_clut<const> = ${(slot.clut.x | (slot.clut.y << 16)) >>> 0}`);
			exports.push(`${name}_clut`);
		}
	}
	const lines = declarations.slice();
	lines.push('', 'return {');
	for (let index = 0; index < exports.length; index += 1) {
		lines.push(`\t${exports[index]} = ${exports[index]},`);
	}
	lines.push('}', '');
	return lines.join('\n');
}
