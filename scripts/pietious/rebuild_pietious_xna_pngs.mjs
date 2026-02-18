#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'src/carts/pietious/res/img');
const sourceProjectRoot = process.env.MAZE_OF_NICOLAAS_XNA_ROOT ?? '/tmp/Maze-of-Nicolaas-XNA-ref/Maze of Nicolaas XNA';
const cppSourceRoot = path.join(sourceProjectRoot, 'Images');
const xnaSourceRoot = path.join(sourceProjectRoot, 'Maze of Nicolaas XNAContent');
const contentProjPath = path.join(xnaSourceRoot, 'Maze of Nicolaas XNAContent.contentproj');

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function readContentProjectColorKeys(contentXml) {
	const keys = new Map();
	const compileRegex = /<Compile Include="([^"]+\.bmp)">([\s\S]*?)<\/Compile>/g;
	let compileMatch;
	while ((compileMatch = compileRegex.exec(contentXml)) !== null) {
		const includeName = compileMatch[1];
		const block = compileMatch[2];
		const keyMatch = /<ProcessorParameters_ColorKeyColor>\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*<\/ProcessorParameters_ColorKeyColor>/.exec(block);
		if (keyMatch) {
			keys.set(includeName, {
				r: Number(keyMatch[1]),
				g: Number(keyMatch[2]),
				b: Number(keyMatch[3]),
				a: Number(keyMatch[4]),
			});
		}
	}
	return keys;
}

function decodeBmp(filePath) {
	const bytes = fs.readFileSync(filePath);
	assert(bytes.length >= 54, `BMP too small: ${filePath}`);
	assert(bytes.toString('ascii', 0, 2) === 'BM', `Not a BMP file: ${filePath}`);

	const pixelOffset = bytes.readUInt32LE(10);
	const dibHeaderSize = bytes.readUInt32LE(14);
	const widthSigned = bytes.readInt32LE(18);
	const heightSigned = bytes.readInt32LE(22);
	const planes = bytes.readUInt16LE(26);
	const bitsPerPixel = bytes.readUInt16LE(28);
	const compression = bytes.readUInt32LE(30);
	const colorsUsed = bytes.readUInt32LE(46);

	assert(planes === 1, `Unexpected BMP planes=${planes}: ${filePath}`);
	assert(compression === 0, `Unsupported BMP compression=${compression}: ${filePath}`);

	const width = Math.abs(widthSigned);
	const height = Math.abs(heightSigned);
	const isTopDown = heightSigned < 0;
	assert(width > 0 && height > 0, `Invalid BMP dimensions ${width}x${height}: ${filePath}`);

	const rgba = new Uint8Array(width * height * 4);
	const rowStrideBytes = Math.floor((bitsPerPixel * width + 31) / 32) * 4;

	let palette = null;
	if (bitsPerPixel <= 8) {
		const paletteSize = colorsUsed || (1 << bitsPerPixel);
		const paletteOffset = 14 + dibHeaderSize;
		palette = new Array(paletteSize);
		for (let i = 0; i < paletteSize; i += 1) {
			const p = paletteOffset + i * 4;
			const blue = bytes[p];
			const green = bytes[p + 1];
			const red = bytes[p + 2];
			palette[i] = { r: red, g: green, b: blue, a: 255 };
		}
	}

	for (let y = 0; y < height; y += 1) {
		const srcY = isTopDown ? y : height - 1 - y;
		const rowStart = pixelOffset + srcY * rowStrideBytes;
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 255;

			if (bitsPerPixel === 24) {
				const p = rowStart + x * 3;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
			} else if (bitsPerPixel === 32) {
				const p = rowStart + x * 4;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
				a = bytes[p + 3];
			} else if (bitsPerPixel === 8) {
				const idx = bytes[rowStart + x];
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 4) {
				const packed = bytes[rowStart + Math.floor(x / 2)];
				const idx = x % 2 === 0 ? packed >> 4 : packed & 0x0f;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 1) {
				const packed = bytes[rowStart + Math.floor(x / 8)];
				const shift = 7 - (x % 8);
				const idx = (packed >> shift) & 1;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else {
				throw new Error(`Unsupported BMP bpp=${bitsPerPixel}: ${filePath}`);
			}

			const outIndex = (y * width + x) * 4;
			rgba[outIndex] = r;
			rgba[outIndex + 1] = g;
			rgba[outIndex + 2] = b;
			rgba[outIndex + 3] = a;
		}
	}

	return { width, height, data: rgba };
}

function cropImage(image, crop) {
	if (!crop) {
		return image;
	}
	const { x, y, w, h } = crop;
	assert(x >= 0 && y >= 0 && w > 0 && h > 0, `Invalid crop ${JSON.stringify(crop)}`);
	assert(x + w <= image.width && y + h <= image.height, `Crop out of bounds ${JSON.stringify(crop)} for ${image.width}x${image.height}`);
	const out = new Uint8Array(w * h * 4);
	for (let cy = 0; cy < h; cy += 1) {
		for (let cx = 0; cx < w; cx += 1) {
			const srcIndex = ((y + cy) * image.width + (x + cx)) * 4;
			const dstIndex = (cy * w + cx) * 4;
			out[dstIndex] = image.data[srcIndex];
			out[dstIndex + 1] = image.data[srcIndex + 1];
			out[dstIndex + 2] = image.data[srcIndex + 2];
			out[dstIndex + 3] = image.data[srcIndex + 3];
		}
	}
	return { width: w, height: h, data: out };
}

function applyColorKey(image, keyColor) {
	if (!keyColor) {
		return image;
	}
	for (let i = 0; i < image.data.length; i += 4) {
		if (
			image.data[i] === keyColor.r &&
			image.data[i + 1] === keyColor.g &&
			image.data[i + 2] === keyColor.b
		) {
			image.data[i + 3] = 0;
		}
	}
	return image;
}

function writePng(filePath, image) {
	const png = new PNG({ width: image.width, height: image.height });
	png.data = Buffer.from(image.data);
	const buffer = PNG.sync.write(png);
	fs.writeFileSync(filePath, buffer);
}

function createMappings() {
	const mappings = new Map();

	const add = (outputName, sourceName, options = {}) => {
		assert(!mappings.has(outputName), `Duplicate mapping for ${outputName}`);
		mappings.set(outputName, {
			sourceName,
			crop: options.crop,
			useSourceColorKey: options.useSourceColorKey !== false,
		});
	};

	for (let x = 1; x <= 4; x += 1) {
		for (let y = 1; y <= 4; y += 1) {
			add(`castle_tile_garden_${x}_${y}`, `BackTiles_Garden_${x}_${y}`);
			add(`castle_tile_red_${x}_${y}`, `BackTiles_Red_${x}_${y}`);
			add(`castle_tile_stone_${x}_${y}`, `BackTiles_Stone_${x}_${y}`);
		}
		add(`castle_tile_garden_dark_${x}`, `BackTiles_Garden_dark_${x}`);
		add(`castle_tile_red_dark_${x}`, `BackTiles_Red_dark_${x}`);
		add(`castle_tile_stone_dark_${x}`, `BackTiles_Stone_dark_${x}`);
	}

	add('castle_tile_gold_l', 'BackTiles_Gold_1');
	add('castle_tile_gold_r', 'BackTiles_Gold_2');
	add('castle_tile_gold_l_dark', 'BackTiles_Gold_dark_1');
	add('castle_tile_gold_r_dark', 'BackTiles_Gold_dark_2');

	add('castle_tile_stone_1', 'BackTiles_Stone_1_1');
	add('castle_tile_stone_2', 'BackTiles_Stone_1_2');
	add('castle_tile_stone_3', 'BackTiles_Stone_1_3');
	add('castle_tile_stone_4', 'BackTiles_Stone_1_4');
	add('castle_tile_stone_dark', 'BackTiles_Stone_dark_1');

	add('castle_front_blue_1', 'WorldTiles1');
	add('castle_front_gold_1', 'WorldTiles39');
	add('castle_tile_blue_l', 'WorldTiles3');
	add('castle_tile_blue_r', 'WorldTiles4');
	add('castle_tile_blue_l_dark', 'WorldTiles5');
	add('castle_tile_blue_r_dark', 'WorldTiles6');
	add('frontworld_blue_l', 'WorldTiles1');
	add('frontworld_blue_r', 'WorldTiles2');
	add('frontworld_l', 'WorldTiles7');
	add('frontworld_wall_disappear_at_summon', 'WorldTiles8');

	add('backworld_ul', 'BackTiles1');
	add('backworld_ur', 'BackTiles2');
	add('backworld_dl', 'BackTiles3');
	add('backworld_dr', 'BackTiles4');
	add('backworld_ul_dark', 'BackTiles5');
	add('backworld_ur_dark', 'BackTiles6');
	add('backworld_dl_dark', 'BackTiles7');
	add('backworld_dr_dark', 'BackTiles8');
	add('backworld_pillar_l1', 'WorldTiles9');
	add('backworld_pillar_r1', 'WorldTiles10');
	add('backworld_pillar_l2', 'WorldTiles11');
	add('backworld_pillar_r2', 'WorldTiles12');
	add('backworld_pillar_l3', 'WorldTiles13');
	add('backworld_pillar_r3', 'WorldTiles14');

	const pillarSets = {
		blue: 15,
		garden: 21,
		stone: 27,
		red: 33,
	};
	for (const [theme, base] of Object.entries(pillarSets)) {
		add(`castle_pillar_${theme}_l1`, `WorldTiles${base}`);
		add(`castle_pillar_${theme}_r1`, `WorldTiles${base + 1}`);
		add(`castle_pillar_${theme}_l2`, `WorldTiles${base + 2}`);
		add(`castle_pillar_${theme}_r2`, `WorldTiles${base + 3}`);
		add(`castle_pillar_${theme}_l3`, `WorldTiles${base + 4}`);
		add(`castle_pillar_${theme}_r3`, `WorldTiles${base + 5}`);
	}

	add('castle_stairs_l', 'Stairs1');
	add('castle_stairs_r', 'Stairs2');
	add('castle_block_stone', 'Stone');

	add('game_header', 'GameHeader', { useSourceColorKey: false });
	add('energybar_stripe_blue', 'Energybar_stripe_blue');
	add('energybar_stripe_red', 'Energybar_stripe_red');
	add('f1_screen', 'F1Screen', { useSourceColorKey: false });
	add('f1_selector_white', 'F1_selector_white');
	add('f1_map_title', 'F1Screen_MapTitle');
	add('room_proxy', 'RoomProxy');
	add('room_proxy_blue', 'RoomProxy_Blue');
	add('room_proxy_red', 'RoomProxy_Red');
	add('map', 'Map');
	add('world_key', 'World_Key');
	add('world_entrance', 'World_Entrance');
	add('world_entrance_half_open', 'World_Entrance_Half_Open');
	add('world_entrance_open', 'World_Entrance_Open');
	add('shrine', 'Shrine');
	add('shrine_inside', 'Shrine_Inside');
	add('halo', 'Halo');
	add('schoentjes', 'Schoentjes');
	add('spyglass', 'Spyglass');
	add('ammo', 'Ammo');
	add('item_health', 'Item_Health');
	add('item_lamp', 'Item_Lamp');
	add('item_greenvase', 'Item_GreenVase');
	add('pepernoot_16@cx', 'Pepernoot_16');

	add('meijter_r@cx', 'MeiterRight');
	add('meijter_dr@cx', 'MeiterDownRight');
	add('meijter_up@cx', 'MeiterUp');

	add('stone@cx', 'Stone');
	add('stone_broken', 'Stone_Broken');
	add('elevator_platform@cx', 'Elevator');
	add('crossfoe@cx', 'CrossFoe');
	add('crossfoe_turned@cx', 'CrossFoeTurned');
	add('marspeinenaardappel@cx', 'MarsepeinenAardappel');
	add('muziekfoe@cx', 'MuziekFoe');
	add('muzieknootfoe@cx', 'MuziekNootFoe');
	add('boekfoe_closed@cx', 'BoekFoe_Closed');
	add('boekfoe_open@cx', 'BoekFoe_Open');
	add('boekfoe_paper@cx', 'BoekFoe_Paper');
	add('stafffoe@cx', 'StaffFoe');
	add('staffspawn@cx', 'StaffSpawn');
	add('cloud_1@cx', 'Cloud_1');
	add('cloud_2@cx', 'Cloud_2');
	add('vlok@cx', 'Vlok');
	add('zakfoe_stand@cx', 'ZakFoe3');
	add('zakfoe_jump@cx', 'ZakFoe2');
	add('zakfoe_recover@cx', 'ZakFoe');
	add('explosion_1', 'Explosion_1');
	add('explosion_2', 'Explosion_2');
	add('explosion_3', 'Explosion_3');
	add('sword_r@cx', 'Popolon_Slash_R', { crop: { x: 16, y: 0, w: 16, h: 16 } });

	add('pietolon_stand_r@cx', 'Popolon_Stand_R');
	add('pietolon_walk_r@cx', 'Popolon_Walk_R');
	add('pietolon_jump_r@cx', 'Popolon_Jump_R');
	add('pietolon_hit_r@cx', 'Popolon_Hit_R');
	add('pietolon_recover_r@cx', 'Popolon_Recover_R');
	add('pietolon_stairs_up_1@cx', 'Popolon_Stairs_Up_1');
	add('pietolon_stairs_up_2@cx', 'Popolon_Stairs_Up_2');
	add('pietolon_stairs_down_1@cx', 'Popolon_Stairs_Down_1');
	add('pietolon_stairs_down_2@cx', 'Popolon_Stairs_Down_2');
	add('pietolon_dying_1', 'Popolon_Dying_1');
	add('pietolon_dying_2', 'Popolon_Dying_2');
	add('pietolon_dying_3', 'Popolon_Dying_3');
	add('pietolon_dying_4', 'Popolon_Dying_4');
	add('pietolon_dying_5', 'Popolon_Dying_5');

	add('pietolon_slash_r@cx', 'Popolon_Slash_R', { crop: { x: 0, y: 0, w: 16, h: 16 } });
	add('pietolon_jumpslash_r@cx', 'Popolon_JumpSlash_R', { crop: { x: 0, y: 0, w: 16, h: 16 } });

	return mappings;
}

function ensureAllOutputsCovered(mappings) {
	const outputPngFiles = fs.readdirSync(outputDir)
		.filter((name) => name.endsWith('.png'))
		.sort();
	const outputSet = new Set(outputPngFiles.map((name) => name.slice(0, -4)));
	const mappingSet = new Set(mappings.keys());

	const missingMappings = [];
	for (const outputName of outputSet) {
		if (!mappingSet.has(outputName)) {
			missingMappings.push(outputName);
		}
	}

	const staleMappings = [];
	for (const mappedName of mappingSet) {
		if (!outputSet.has(mappedName)) {
			staleMappings.push(mappedName);
		}
	}

	assert(
		missingMappings.length === 0,
		`Missing mapping(s) for output asset(s): ${missingMappings.join(', ')}`,
	);
	assert(
		staleMappings.length === 0,
		`Mapping(s) found for non-existing output asset(s): ${staleMappings.join(', ')}`,
	);
}

function main() {
	assert(fs.existsSync(outputDir), `Output directory not found: ${outputDir}`);
	assert(fs.existsSync(sourceProjectRoot), `Source project root not found: ${sourceProjectRoot}`);
	assert(fs.existsSync(cppSourceRoot), `C++ image directory not found: ${cppSourceRoot}`);
	assert(fs.existsSync(xnaSourceRoot), `XNA content directory not found: ${xnaSourceRoot}`);
	assert(fs.existsSync(contentProjPath), `Content project not found: ${contentProjPath}`);

	const contentXml = fs.readFileSync(contentProjPath, 'utf8');
	const sourceColorKeys = readContentProjectColorKeys(contentXml);
	const mappings = createMappings();

	ensureAllOutputsCovered(mappings);

	let converted = 0;
	let convertedFromCpp = 0;
	let convertedFromXna = 0;
	let overlapConvertedFromCpp = 0;
	let cppOnlyConverted = 0;
	let xnaOnlyConverted = 0;
	for (const [outputName, mapping] of mappings.entries()) {
		const sourceFileName = `${mapping.sourceName}.bmp`;
		const cppPath = path.join(cppSourceRoot, sourceFileName);
		const xnaPath = path.join(xnaSourceRoot, sourceFileName);
		const cppExists = fs.existsSync(cppPath);
		const xnaExists = fs.existsSync(xnaPath);
		assert(cppExists || xnaExists, `Source BMP missing in both roots: ${sourceFileName}`);

		let sourcePath = xnaPath;
		if (cppExists) {
			sourcePath = cppPath;
		}

		let image = decodeBmp(sourcePath);
		image = cropImage(image, mapping.crop);

		const sourceColorKey = sourceColorKeys.get(sourceFileName);
		if (mapping.useSourceColorKey && sourceColorKey) {
			image = applyColorKey(image, sourceColorKey);
		}

		const outputPath = path.join(outputDir, `${outputName}.png`);
		writePng(outputPath, image);
		converted += 1;
		if (sourcePath === cppPath) {
			convertedFromCpp += 1;
			if (xnaExists) {
				overlapConvertedFromCpp += 1;
			} else {
				cppOnlyConverted += 1;
			}
		} else {
			convertedFromXna += 1;
			xnaOnlyConverted += 1;
		}
	}

	console.log(`Converted ${converted} pietious PNG assets.`);
	console.log(`  from C++ source: ${convertedFromCpp} (overlap: ${overlapConvertedFromCpp}, cpp-only: ${cppOnlyConverted})`);
	console.log(`  from XNA source: ${convertedFromXna} (xna-only: ${xnaOnlyConverted})`);
}

main();
