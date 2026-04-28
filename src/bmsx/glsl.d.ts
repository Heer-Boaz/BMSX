// Allow importing shader sources as plain strings from several common extensions.
// This keeps imports like `import src from './shader.glsl'` or
// `import src from './shader.glsl?raw'` typed as `string`.
//
// Many bundlers (Vite/Rollup/webpack) support importing non-code files. Some
// (like Vite) also support the `?raw` query which forces a raw text import.
// Adding these declarations keeps TypeScript happy and documents the intended
// usage.

declare module '*.glsl' {
	const value: string;
	export default value;
	// named export is handy when you want to be explicit
	export const source: string;
}

declare module '*.vert' {
	const value: string;
	export default value;
	export const source: string;
}

declare module '*.frag' {
	const value: string;
	export default value;
	export const source: string;
}

declare module '*.vs' {
	const value: string;
	export default value;
	export const source: string;
}

declare module '*.fs' {
	const value: string;
	export default value;
	export const source: string;
}

// Vite-style raw imports: `import s from './shader.glsl?raw'`
declare module '*?raw' {
	const content: string;
	export default content;
}
