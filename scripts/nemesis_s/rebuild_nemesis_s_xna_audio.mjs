#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'carts/nemesis_s/res/sound');
const sourceDir = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWarContent/Sound',
);

const mappings = [
	['Nemesis2_Kogeltje.wav', 'nemesis2_kogeltje@p=1.wav'],
	['Nemesis2_Laser.wav', 'nemesis2_laser@p=1.wav'],
	['Nemesis2_FoeLaser.wav', 'nemesis2_foe_laser@p=10.wav'],
	['Parodius_EnemySpawn.wav', 'parodius_enemy_spawn@p=5.wav'],
	['Nemesis2_StructureExplosion.wav', 'nemesis2_structure_explosion@p=10.wav'],
	['Nemesis2_Torendood.wav', 'nemesis2_torendood@p=7.wav'],
	['Nemesis2_SomethingFell.wav', 'nemesis2_something_fell@p=10.wav'],
	['Nemesis2_Bosshit.wav', 'nemesis2_boss_hit@p=8.wav'],
	['Nemesis2_StructureHit.wav', 'nemesis2_structure_hit@p=5.wav'],
	['Nemesis2_CoreExplostion.wav', 'nemesis2_core_explosion@p=15.wav'],
	['Nemesis2_FoeDeath.wav', 'nemesis2_foe_death@p=6.wav'],
	['Nemesis2_Roodje.wav', 'nemesis2_roodje@p=9.wav'],
	['Nemesis2_FoeLaser3.wav', 'nemesis2_foe_laser_3@p=10.wav'],
	['Nemesis2_FoeUberLaser.wav', 'nemesis2_foe_uber_laser@p=15.wav'],
	['Nemesis2_BossExplosion.wav', 'nemesis2_boss_explosion@p=100.wav'],
	['Nemesis2_PowerupTaken.wav', 'nemesis2_powerup_taken@p=11.wav'],
	['Nemesis2_Pause.wav', 'nemesis2_pause@p=98.wav'],
	['Nemesis3_OptionTake.wav', 'nemesis3_option_take@p=11.wav'],
	['Nemesis2_EndDemo.wav', 'music_end_demo.wav'],
];

fs.mkdirSync(outputDir, { recursive: true });
for (let index = 0; index < mappings.length; index += 1) {
	const mapping = mappings[index];
	fs.copyFileSync(
		path.join(sourceDir, mapping[0]),
		path.join(outputDir, mapping[1]),
	);
}

console.log(`Copied ${mappings.length} nemesis_s audio assets into ${outputDir}`);
