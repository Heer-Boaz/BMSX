const STUB_MODULES = new Map([
	['src/bmsx/console/api.ts', `
export class BmsxConsoleApi {
	emit(_eventName, _payload, _emitterId) {}
	emit_gameplay(_eventName, _emitterId, _payload) {}
	emit_presentation(_eventName, _emitterId, _payload) {}
}
`],
	['src/bmsx/serializer/gameserializer.ts', `
export class Serializer {
	static onSaves = Object.create(null);
	static excludedProperties = Object.create(null);
	static excludedObjectTypes = new Set();
	static propertyIncludeExcludeMap = new Map();
	static classExcludeMap = new Map();
}
export class Reviver {
	static constructors = Object.create(null);
	static onLoads = Object.create(null);
	static excludedProperties = Object.create(null);
}
export const ConstructorWithSaveGame = class {};
`],
	['src/bmsx/core/game.ts', `
const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
export const $ = {
	paused: false,
	input: {
		getPlayerInput: () => (globalScope.__BMSX_TEST_PLAYER_INPUT ?? null),
	},
};
`],
]);

const GLSL_PREFIX = 'stub:glsl:';
const MODULE_PREFIX = 'stub:module:';

function tryResolveStub(specifier, parentURL) {
	if (specifier.endsWith('.glsl')) {
		const url = new URL(specifier, parentURL);
		return `${GLSL_PREFIX}${url.href}`;
	}
	const url = new URL(specifier, parentURL);
	for (const [suffix] of STUB_MODULES) {
		if (url.pathname.endsWith(`/${suffix}`)) {
			return `${MODULE_PREFIX}${suffix}`;
		}
	}
	return null;
}

export async function resolve(specifier, context, defaultResolve) {
	const stubUrl = tryResolveStub(specifier, context.parentURL);
	if (stubUrl) {
		return { url: stubUrl, shortCircuit: true };
	}
	return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
	if (url.startsWith(GLSL_PREFIX)) {
		return {
			format: 'module',
			source: 'export default ``;',
			shortCircuit: true,
		};
	}
	if (url.startsWith(MODULE_PREFIX)) {
		const key = url.substring(MODULE_PREFIX.length);
		const source = STUB_MODULES.get(key);
		if (!source) {
			throw new Error(`Missing stub source for ${key}`);
		}
		return {
			format: 'module',
			source,
			shortCircuit: true,
		};
	}
	if (url.startsWith('file:')) {
		const pathname = new URL(url).pathname;
		for (const [suffix, source] of STUB_MODULES) {
			if (pathname.endsWith(`/${suffix}`)) {
				return {
					format: 'module',
					source,
					shortCircuit: true,
				};
			}
		}
	}
	return defaultLoad(url, context, defaultLoad);
}
