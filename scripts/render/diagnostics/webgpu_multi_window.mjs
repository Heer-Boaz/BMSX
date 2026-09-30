// Standalone browser diagnostic, not a Studio test or a product startup policy.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, errors } from 'playwright';

const { values } = parseArgs({ options: { draws: { type: 'string', default: '10' } } });
const args = [
	'--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
	'--use-angle=vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface',
	'--disable-dev-shm-usage',
];
const browser = await chromium.launch({ args });
let pageErrors = 0;
try {
	console.log(JSON.stringify({ browser: browser.version(), args, draws: values.draws }));
	const diagnostics = await browser.newBrowserCDPSession();
	const { gpu } = await diagnostics.send('SystemInfo.getInfo');
	console.log(JSON.stringify({ gpuDevices: gpu.devices }));
	await diagnostics.detach();
	const context = await browser.newContext();
	// Interception supplies a secure localhost origin without running any server.
	const url = `http://localhost/webgpu-multi-window?draws=${values.draws}`;
	await context.route(url, route => route.fulfill({
		contentType: 'text/html', path: fileURLToPath(new URL('./webgpu_multi_window.html', import.meta.url)),
	}));
	for (let index = 0; index < 3; index++) {
		const page = await context.newPage();
		page.on('console', message => console.log(`[${index + 1}] ${message.type()}: ${message.text()}`));
		page.on('pageerror', error => { pageErrors++; console.error(`[${index + 1}]`, error); });
		await page.goto(url);
		const ready = page.locator('body[data-stage="ready"]');
		try {
			await ready.waitFor({ timeout: 15_000 });
		} catch (error) {
			if (!(error instanceof errors.TimeoutError) || index !== 2) throw error;
			console.log(JSON.stringify({
				outcome: 'initialization-delayed', window: index + 1,
				stage: await page.locator('body').getAttribute('data-stage'), observationMs: 15_000,
			}));
			// Dispatch to the fixture's controls without focusing other tabs: focus
			// changes would also change scheduling and confound the observation.
			for (const previous of context.pages().slice(0, 2)) {
				await previous.locator('#stop').dispatchEvent('click');
			}
			const stoppedAt = performance.now();
			await ready.waitFor({ timeout: 20_000 });
			console.log(JSON.stringify({
				outcome: 'initialization-released-after-stop', elapsedMs: performance.now() - stoppedAt,
			}));
			break;
		}
		console.log(JSON.stringify({ outcome: 'initialized', window: index + 1 }));
		// Establish sustained render load before adding the next independent page.
		await page.waitForTimeout(2_000);
	}
	if (pageErrors !== 0) throw new Error(`${pageErrors} page error(s); see diagnostic output`);
} finally {
	await browser.close();
}
