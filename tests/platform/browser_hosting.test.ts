import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Azure keeps per-game trace packages canonical and retires the unrelated Piet path', async () => {
	const config = JSON.parse(await readFile('deploy/azure/staticwebapp.config.json', 'utf8'));
	assert.deepEqual(config.routes.find((rule: { route: string }) => rule.route === '/ios/index.html'),
		{ route: '/ios/index.html', redirect: '/nemesis_s/ios/', statusCode: 302 });
	assert.ok(config.routes.every((rule: { route: string; redirect: string }) =>
		!rule.route.startsWith('/ios/piet/') && !rule.redirect.startsWith('/ios/piet/')));
	for (const game of ['2025', 'nemesis_s'])
		assert.ok(!config.routes.some((rule: { route: string }) => rule.route === `/${game}/ios/index.html`));
});
