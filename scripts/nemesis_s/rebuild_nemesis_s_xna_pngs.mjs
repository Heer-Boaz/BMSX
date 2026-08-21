#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'carts/nemesis_s/res/img');
const sourceRoot = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWarContent/Images',
);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
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
	const encoded = PNG.sync.write(png);
	fs.writeFileSync(filePath, encoded);
}

function getMappings() {
	const mappings = [
		{
			source: 'OtherMisc/CurtainPart.bmp',
			target: 'game_over_curtain@atlas=18.png',
		},
		{
			source: 'Story/KasteelSint3.bmp',
			target: 'story_coup@atlas=2.png',
		},
		{
			source: 'Story/Pieton1_muts.bmp',
			target: 'story_piet1@atlas=3.png',
		},
		{
			source: 'Story/OldTimer.bmp',
			target: 'story_escape@atlas=4.png',
		},
		{
			source: 'Story/Boot.bmp',
			target: 'story_boot@atlas=5.png',
		},
		{
			source: 'Story/Winterstad.bmp',
			target: 'story_winterstad@atlas=6.png',
		},
		{
			source: 'Story/Pieton2_muts.bmp',
			target: 'story_piet2@atlas=7.png',
		},
		{
			source: 'Story/Bingmaps.bmp',
			target: 'story_map@atlas=8.png',
		},
		{
			source: 'Story/Metalion.bmp',
			target: 'story_metalion@atlas=9.png',
		},
		{
			source: 'Story/PilootPiet.bmp',
			target: 'story_pilot@atlas=10.png',
		},
		{
			source: 'EndDemo/SintDuim.bmp',
			target: 'end_demo_sint_duim@atlas=16.png',
		},
		{
			source: 'EndDemo/BoazFoto.bmp',
			target: 'end_demo_boaz@atlas=17.png',
		},
		{
			source: 'OtherMisc/MainScreen1.bmp',
			target: 'title_screen_1@atlas=11.png',
		},
		{
			source: 'OtherMisc/MainScreen2.bmp',
			target: 'title_screen_2@atlas=11.png',
		},
		{
			source: 'OtherMisc/Hangar1.bmp',
			target: 'title_hangar_1@atlas=12.png',
		},
		{
			source: 'OtherMisc/Hangar2.bmp',
			target: 'title_hangar_2@atlas=12.png',
		},
		{
			source: 'OtherMisc/MainScreen_Selector.bmp',
			target: 'title_selector@atlas=13.png',
		},
		{
			source: 'OtherMisc/HangarBottomHider.bmp',
			target: 'title_hangar_bottom_hider@atlas=13.png',
		},
		{
			source: 'OtherMisc/Startup_Metalion.bmp',
			target: 'title_startup_metalion@atlas=13.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'OtherMisc/Startup_Metalion_Burst1.bmp',
			target: 'title_startup_metalion_burst_1@atlas=13.png',
		},
		{
			source: 'OtherMisc/Startup_Metalion_Burst2.bmp',
			target: 'title_startup_metalion_burst_2@atlas=13.png',
		},
		{
			source: 'OtherMisc/Startup_Metalion_Burst3.bmp',
			target: 'title_startup_metalion_burst_3@atlas=13.png',
		},
		{
			source: 'Misc/PowerupBar_empty.bmp',
			target: 'status_powerup_empty@atlas=15.png',
		},
		{
			source: 'Misc/PowerupBar_filled.bmp',
			target: 'status_powerup_filled@atlas=15.png',
		},
		{
			source: 'Misc/PowerupBar_takenup.bmp',
			target: 'status_powerup_taken@atlas=15.png',
		},
		{
			source: 'Misc/PowerupBar_takenup_current.bmp',
			target: 'status_powerup_taken_current@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Speed.bmp',
			target: 'status_description_speed@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Missile.bmp',
			target: 'status_description_missile@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Laser.bmp',
			target: 'status_description_laser@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Option.bmp',
			target: 'status_description_option@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Shield.bmp',
			target: 'status_description_shield@atlas=15.png',
		},
		{
			source: 'Misc/Powerup_Enabled.bmp',
			target: 'status_description_enabled@atlas=15.png',
		},
		{
			source: 'Misc/StatusBar_Ship.bmp',
			target: 'status_ship@atlas=15.png',
		},
		{
			source: 'Player/Metallion_n.bmp',
			target: 'metallion_n.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_u.bmp',
			target: 'metallion_u.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_d.bmp',
			target: 'metallion_d.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_n_shield.bmp',
			target: 'metallion_n_shield.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_d_shield.bmp',
			target: 'metallion_d_shield.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Shield1.bmp',
			target: 'force_field_1.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Shield2.bmp',
			target: 'force_field_2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Shield3.bmp',
			target: 'force_field_3.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Shield4.bmp',
			target: 'force_field_4.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option1.bmp',
			target: 'option1.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option2.bmp',
			target: 'option2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option3.bmp',
			target: 'option3.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option4.bmp',
			target: 'option4.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Metallion_n_P2.bmp',
			target: 'metallion_n_p2.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_u_P2.bmp',
			target: 'metallion_u_p2.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_d_P2.bmp',
			target: 'metallion_d_p2.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_n_shield_P2.bmp',
			target: 'metallion_n_shield_p2.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_d_shield_P2.bmp',
			target: 'metallion_d_shield_p2.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Option1_P2.bmp',
			target: 'option1_p2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option2_P2.bmp',
			target: 'option2_p2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option3_P2.bmp',
			target: 'option3_p2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Player/Option4_P2.bmp',
			target: 'option4_p2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Projectiles/Kogeltje.bmp',
			target: 'kogeltje.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/SintPop.bmp',
			target: 'sint_pop.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe1Blue.bmp',
			target: 'mijter_foe_blue_neutral.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe2Blue.bmp',
			target: 'mijter_foe_blue_up.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe3Blue.bmp',
			target: 'mijter_foe_blue_down.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe1.bmp',
			target: 'mijter_foe_red_neutral.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe2.bmp',
			target: 'mijter_foe_red_up.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/MijterFoe3.bmp',
			target: 'mijter_foe_red_down.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Foes/SchoorsteenFoe12.bmp',
			target: 'schoorsteen_foe_1.png',
		},
		{
			source: 'Foes/SchoorsteenFoe22.bmp',
			target: 'schoorsteen_foe_2.png',
		},
		{
			source: 'Foes/SchoorsteenFoe32.bmp',
			target: 'schoorsteen_foe_3.png',
		},
		{
			source: 'Foes/SchoorsteenFoe42.bmp',
			target: 'schoorsteen_foe_4.png',
		},
		{
			source: 'Foes/SchoorsteenFoe52.bmp',
			target: 'schoorsteen_foe_5.png',
		},
		{
			source: 'Foes/Schoorsteenflash1.bmp',
			target: 'schoorsteen_flash_1.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Schoorsteenflash2.bmp',
			target: 'schoorsteen_flash_2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/SchoorsteenRay.bmp',
			target: 'schoorsteen_ray.png',
		},
		{
			source: 'Projectiles/Bullet.bmp',
			target: 'enemy_bullet.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/RookGenerator11.bmp',
			target: 'rook_generator_open.png',
		},
		{
			source: 'Foes/RookGenerator22.bmp',
			target: 'rook_generator_closed.png',
		},
		{
			source: 'Foes/Rook1.bmp',
			target: 'rook_1.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Rook2.bmp',
			target: 'rook_2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Rook3.bmp',
			target: 'rook_3.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/ZakFoe.bmp',
			target: 'zak_foe_stand.png',
			colorKey: { r: 255, g: 255, b: 255 },
		},
		{
			source: 'Foes/ZakFoe2.bmp',
			target: 'zak_foe_jump.png',
			colorKey: { r: 255, g: 255, b: 255 },
		},
		{
			source: 'Foes/ZakFoe3.bmp',
			target: 'zak_foe_recover.png',
			colorKey: { r: 255, g: 255, b: 255 },
		},
		{
			source: 'Foes/Sneeuwpop2.bmp',
			target: 'sneeuwpop.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/SneeuwpopRay.bmp',
			target: 'sneeuwpop_ray.png',
		},
		{
			source: 'Foes/SneeuwpopKaput.bmp',
			target: 'sneeuwpop_destroyed.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Boss/Kerk.bmp',
			target: 'kerk.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Boss/Bel_klein.bmp',
			target: 'bel_middle.png',
		},
		{
			source: 'Foes/Boss/Bel2_klein.bmp',
			target: 'bel_side.png',
		},
		{
			source: 'Foes/Boss/MuziekNootFoe.bmp',
			target: 'noot.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Misc/Roodje.bmp',
			target: 'roodje.png',
		},
		{
			source: 'FX/FoeDeath1.bmp',
			target: 'small_explosion_1.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'FX/FoeDeath2.bmp',
			target: 'small_explosion_2.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'FX/FoeDeath3.bmp',
			target: 'small_explosion_3.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'FX/FoeDeath4.bmp',
			target: 'small_explosion_4.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'FX/Explosion1.bmp',
			target: 'large_explosion_1.png',
		},
		{
			source: 'FX/Explosion2.bmp',
			target: 'large_explosion_2.png',
		},
		{
			source: 'FX/Explosion3.bmp',
			target: 'large_explosion_3.png',
		},
		{
			source: 'Foes/Boss/Moon11.bmp',
			target: 'moon_right.png',
		},
		{
			source: 'Foes/Boss/Moon22.bmp',
			target: 'moon_down_right.png',
		},
		{
			source: 'Foes/Boss/Moon33.bmp',
			target: 'moon_up.png',
		},
		{
			source: 'Foes/Boss/Moon44.bmp',
			target: 'moon_up_right.png',
		},
		{
			source: 'Foes/Boss/Minimoon1.bmp',
			target: 'mini_moon.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Boss/Minimoon2.bmp',
			target: 'mini_moon_red.png',
			colorKey: { r: 255, g: 0, b: 255 },
		},
		{
			source: 'Foes/Boss/RayOfDeath.bmp',
			target: 'moon_death_ray.png',
		},
		{
			source: 'Foes/Boss/RayOfDeathStart.bmp',
			target: 'moon_death_ray_start.png',
		},
		{
			source: 'Misc/Star_Blue.bmp',
			target: 'star_blue.png',
		},
		{
			source: 'Misc/Star_Yellow.bmp',
			target: 'star_yellow.png',
		},
		{
			source: 'Stage/ground.bmp',
			target: 'ground.png',
		},
		{
			source: 'Stage/ground2.bmp',
			target: 'ground2.png',
		},
		{
			source: 'Stage/ground_V.bmp',
			target: 'ground_v.png',
		},
		{
			source: 'Stage/ground2_V.bmp',
			target: 'ground2_v.png',
		},
		{
			source: 'Stage/ground3.bmp',
			target: 'ground3.png',
		},
		{
			source: 'Stage/ground4.bmp',
			target: 'ground4.png',
		},
		{
			source: 'Stage/groundStart.bmp',
			target: 'ground_start.png',
		},
		{
			source: 'Stage/groundEnd.bmp',
			target: 'ground_end.png',
		},
		{
			source: 'Stage/groundStart_V.bmp',
			target: 'ground_start_v.png',
		},
		{
			source: 'Stage/groundEnd_V.bmp',
			target: 'ground_end_v.png',
		},
		{
			source: 'Stage/snow.bmp',
			target: 'snow.png',
		},
	];

	const fontGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	for (let i = 0; i < fontGlyphs.length; i += 1) {
		const glyph = fontGlyphs[i];
		mappings.push({
			source: `Text/Letter_${glyph}.bmp`,
			target: `font_${glyph.toLowerCase()}@atlas=14.png`,
		});
	}
	const punctuationGlyphs = [
		['Comma', 'comma'],
		['Dot', 'dot'],
		['Exclamation', 'exclamation'],
		['Question', 'question'],
		['Appostroph', 'apostrophe'],
		['Space', 'space'],
		['Line', 'hyphen'],
	];
	for (let i = 0; i < punctuationGlyphs.length; i += 1) {
		const glyph = punctuationGlyphs[i];
		mappings.push({
			source: `Text/Letter_${glyph[0]}.bmp`,
			target: `font_${glyph[1]}@atlas=14.png`,
		});
	}

	for (let i = 1; i <= 13; i += 1) {
		mappings.push({
			source: `Stage/house_tile_${i}.bmp`,
			target: `house_tile_${i}.png`,
		});
	}

	mappings.push({
		source: 'Stage/house_tile_door.bmp',
		target: 'house_tile_door.png',
	});
	mappings.push({
		source: 'Stage/house_tile_window.bmp',
		target: 'house_tile_window.png',
	});
	mappings.push({
		source: 'Stage/house_tile_window2.bmp',
		target: 'house_tile_window2.png',
	});

	for (let i = 1; i <= 3; i += 1) {
		mappings.push({
			source: `Stage/lantaarn_tile_${i}.bmp`,
			target: `lantaarn_tile_${i}.png`,
		});
	}

	for (let i = 1; i <= 3; i += 1) {
		mappings.push({
			source: `Stage/Schoorsteen${i}.bmp`,
			target: `schoorsteen${i}.png`,
		});
	}

	for (let i = 1; i <= 21; i += 1) {
		mappings.push({
			source: `Stage/SnowTree${i}.bmp`,
			target: `snowtree${i}.png`,
		});
	}

	return mappings;
}

function main() {
	assert(fs.existsSync(sourceRoot), `Source root missing: ${sourceRoot}`);
	fs.mkdirSync(outputDir, { recursive: true });

	const mappings = getMappings();
	for (let i = 0; i < mappings.length; i += 1) {
		const mapping = mappings[i];
		const sourcePath = path.join(sourceRoot, mapping.source);
		assert(fs.existsSync(sourcePath), `Source file missing: ${sourcePath}`);

		let image = decodeBmp(sourcePath);
		if (mapping.colorKey) {
			image = applyColorKey(image, mapping.colorKey);
		}

		const targetPath = path.join(outputDir, mapping.target);
		writePng(targetPath, image);
	}

	console.log(`Converted ${mappings.length} nemesis_s PNG assets into ${outputDir}`);
}

main();
