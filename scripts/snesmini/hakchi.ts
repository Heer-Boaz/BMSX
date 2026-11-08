import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publishFileBytes } from '../lib/file_publish';
import { renderCloverDesktop, type MiniPackage, type MiniProfile } from './package';

/** Optional PC collection publication; the SSH package has no PC dependency. */
export async function updateHakchiCollection(options: {
	repository: string; hakchiDirectory: string; profile: MiniProfile; bundle: MiniPackage;
}): Promise<void> {
	const { repository, hakchiDirectory, profile, bundle } = options;
	const configPath = join(hakchiDirectory, 'config/config.json');
	const config = JSON.parse(await readFile(configPath, 'utf8'));
	const selectedGames: string[] = config.gamesCollectionSettings[profile.collection].SelectedGames;
	const gamesDirectory = join(hakchiDirectory, config.SeparateGameLocalStorage ? 'games_snes' : 'games');
	for (const game of profile.games) {
		const pcDirectory = join(gamesDirectory, game.code);
		const mediaPrefix = `var/lib/hakchi/games/${profile.console}/.storage/${game.code}/`;
		for (const file of bundle.files) {
			if (!file.path.startsWith(mediaPrefix)) continue;
			await publishFileBytes(join(pcDirectory, file.path.slice(mediaPrefix.length)),
				await readFile(join(bundle.directory, file.path)));
		}
		await publishFileBytes(join(pcDirectory, `${game.code}_original.png`), await readFile(join(repository, game.icon)));
		await publishFileBytes(join(pcDirectory, `${game.code}.desktop`), Buffer.from(renderCloverDesktop(game, '/var/games')));
	}
	// Preserve originals, other consoles, folder preferences and unknown settings.
	config.gamesCollectionSettings[profile.collection].SelectedGames = [...new Set([...selectedGames, ...profile.games.map(game => game.code)])];
	await publishFileBytes(configPath, Buffer.from(JSON.stringify(config, null, 2) + '\n'));
}
