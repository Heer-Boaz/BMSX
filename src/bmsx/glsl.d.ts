// This module declaration is required to allow importing GLSL files in TypeScript.
// This is a workaround for the fact that TypeScript does not support importing non-JavaScript files by default.
// This declaration tells TypeScript that any file with a .glsl extension is a module that exports a string.
declare module '*.glsl' {
	const value: string;
	export default value;
}