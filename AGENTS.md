* Ensure that you have the latest version of Node.js installed (preferably v22 or later).
* Install the necessary dependencies by running:
   ```bash
   npm install -D
   ```
* Ensure that you have `typescript` installed locally, as it is required for the build process.
* To validate the bmsx package (the game engine) and to verify the game roms running on the bmsx package, you can build the game engine, scripts, and game roms by running:
   ```bash
   npm run headless:game <gameromname> # WARNING: `<gameromname>` must be replaced with the folder name of the rompack (game) you want to test, e.g. `2025` (`2025` is a great test rom)! This is different from the rom name specified in the `rommanifest.json` file inside the `res` directory! The `rominspector` tool uses the rom name specified in the `rommanifest.json` file, so that is different from this!
   	# N.B. `--debug` flag is implicit for headless mode and cli mode!
   ```
   This command will pack the resources and build the specified rompack (game). The built rompack will be available in the `dist` directory. It will also run the rompack in a headless mode (without a graphical interface) to validate that it works correctly. If there are any errors during the build or runtime, they will be displayed in the console.
   > Important: The given <romname> must match the name of a directory under `./src/` that contains a `res` subdirectory with the resources for that rompack (game). For example, for the `testrom`, the resources should be located in `./src/testrom/res`. However, the result romfile will be named based on the rommanifest.json file inside the `res` directory!! For example, if the `rommanifest.json` file specifies the name as `yiear`, the resulting romfile will be named `yiear.rom` (or `yiear.debug.rom`) even if the directory is named `ella2023`!
   Also, you should build and test the libretro core by running:
   ```bash
   npm run build:libretro-wsl -- <gameromname> --debug # WARNING: `<gameromname>` must be replaced with the folder name of the rompack (game) you want to test, e.g. `2025` (`2025` is a great test rom)!
   ```
* **Project Structure**: Understand the overall structure of the project, including key directories and files.
* **No legacy fallback**: Avoid adding legacy code or fallbacks.
* **No defensive coding**: Prevent any bug-concealing techniques, silent failures and defensive coding. For example:
	```ts
	private getViewportMetrics(): ViewportMetrics | null {
		const platform = $.platform;
		if (!platform) {
			return null;
		}
		const host = platform.gameviewHost;
		if (!host || typeof host.getCapability !== 'function') {
			return null;
		}
		const provider = host.getCapability('viewport-metrics');
		if (!provider) {
			return null;
		}
		try {
			return provider.getViewportMetrics();
		} catch {
			return null;
		}
	}
	```

	Instead, do this:
	```ts
	private getViewportMetrics(): ViewportMetrics {
		return $.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics(); // Assume all properties and functions exist and work correctly if the code is designed that way. Only use defensive checks if there is a valid reason to believe that the property/function may not exist or work correctly.
	}
	```

	Also, instead of this:
	```ts
	private initializeSomething(): void {
		if (this.isSomethingInitialized) { // Defensive check
			return;
		}
		// ... initialization code ...
		this.isSomethingInitialized = true; // Mark as initialized
	}
	```
	Do this:
	```ts
	private initializeSomething(): void { // Assume this method is only called once
		// ... initialization code ...
	}
	```
	Also avoid code like this:
	```ts
	private doSomething(): void {
		this?.someProperty?.doAction(); // Avoid optional chaining for properties that should always be defined, otherwise it hides potential bugs
	}
	```
	Instead, do this:
	```ts
	interface SomeType {
		doAction(): void;
		doOptionalAction?(): void; // Optional method, so optional chaining is acceptable here! Don't think that optional chaining is always bad, it's only bad when used to hide potential bugs or simplify initialization logic!
	}

	private doSomething(): void {
		this.someProperty.doAction(); // Assume someProperty is always defined, except if there is a valid reason to believe otherwise
		this.someProperty.doOptionalAction?.(); // Use optional chaining only for optional methods/properties
	}
	```

	Also avoid code like this:
	```ts
	private foo(): void {
		if (typeof this.bar === 'function') {
			this.bar(); // Defensive check for function existence
		}
	}
	```
	Instead, do this:
	```ts
	private foo(): void {
		this.bar(); // Assume bar() always exists
	}
	```

	Instead of this:
	```ts
	if (typeof this.onSomething === 'function')
	```

	do this:
	```ts
	this.onSomething();
	```

	Also avoid code like this:
	```ts
	function dumbDefensiveFunction(value: string[]): string[] | null {
		// (...)
		return (value && value.length > 0) ? value : null; // Prevents allowing checks for undefined or empty arrays. Also, why even check for an empty array? Just return the empty array or never call this function with an empty array!
	}
	```
	Instead, do this:
	```ts
	function smartFunction(value: string[]): string[] {
		// (...)
		return value; // Assume value is always a valid, non-empty array, or handle empty arrays as needed without returning null
	}
	```
	Another example for the same:
	```ts
	function ensureActiveCodeTabMatchesLuaSources(): void {
		const context = getActiveCodeTabContext();
		const activePath = context && context.descriptor ? context.descriptor.path : null;
		if (activePath && $.luaSources.path2lua[activePath]) {
			return;
		}
		// (...)
		openLuaCodeTab({ path: entryPath, type: 'lua', asset_id: entryAsset.resid });
	}
	```
	Should be:
	```ts
	function ensureActiveCodeTabMatchesLuaSources(): void {
		const context = getActiveCodeTabContext();
		const activePath = context?.descriptor?.path;
		if (activePath && $.luaSources.path2lua[activePath]) {
			return;
		}
		// (...)
		openLuaCodeTab({ path: entryPath, type: 'lua', asset_id: entryAsset.resid });
	}
	}
	```

	Also avoid code like this:
	```ts
	function anotherDumbDefensiveFunction(num: number): number {
		// (...)
		const defensiveBla = bla ?? null; // What is the point of this? Just use bla directly! If bla is undefined, let it be undefined! Don't be afraid of using truthy checks!
		return defensiveBla;
	}
	```

	Of course, there are valid cases for defensive coding:
	```ts
	function parseJson(jsonString: string): any | null {
		try {
			return JSON.parse(jsonString);
		} catch (e) {
			console.warn('Failed to parse JSON:', e); // Log the error for debugging purposes
			return null; // Valid defensive coding: handle potential JSON parsing errors
		}
	}
	```
	or this:
	```ts
	function getConfigValue(key: string): string {
		const value = this.config[key];
		if (value === undefined) {
			throw new Error(`Configuration key "${key}" is missing.`); // Valid defensive coding: throw an error if a required configuration key is missing
		}
		return value;
	}
	```
	or this:
	```ts
	function fetchData(url: string): Promise<any> {
		return fetch(url)
			.then(response => {
				if (!response.ok) {
					throw new Error(`Network response was not ok: ${response.statusText}`); // Valid defensive coding: handle network errors
				}
				return response.json();
			});
	}
	```
	or this:
	```ts
	function doSomethingComplexWithOptionalParam(param?: SomeType): void {
		if (param) {
			// Handle the case where param is provided
		} else {
			// Handle the case where param is not provided
		}
	}
	```
* No Descriptor-patterns. They suck.
* No Facade/Host/Provider/Service-patterns. They suck.
* Use `TaskGate` and `AssetBarrier` for async operations instead of rolling your own solutions.
* Don't worry about indentation styles. I will take care of formatting the code using Prettier before committing.
* `clamp` is a utility function available that you can find in the folder `/src/bmsx/util/`; use it instead of writing your own!
* Scratch buffers are available in `/src/bmsx/util/scratchbuffer.ts`; use them for temporary data storage instead of allocating new arrays or buffers.
* Look at other utility functions available in `/src/bmsx/util/` before writing your own utility functions!
* Don't use `require` in non-script code (e.g. `rompacker-core.ts` and `rominspector.ts` can have `require`, but core engine files or game source files cannot).
* Ensure that registry persistent objects are not serialized.
* Use the annotations provided in the codebase to maintain consistency, these include:
	* `@attach_components`: Indicates that the decorated class should have `Component`s automatically attached.
	* `@update_tagged_components`: Indicates that the decorated function should update all its components that are subscribed to one or more given tags.
	* `@build_fsm`: Indicates that the decorated function should build a finite state machine (FSM) for the associated class. Note that, when using this decorator, the instances of the class will be automatically assigned the FSM, as long as no arguments are passed to the decorator.
	* `@assign_fsm`: Indicates that the decorated class should be assigned an existing FSM with the given ID.
	* `@onsave`: Indicates that the decorated function should be called when the object is saved.
	* `@onload`: Indicates that the decorated function should be called when the object is loaded.
	* `@insavegame`: Indicates that the decorated class is included in the serialized game state.
	* `@excludefromsavegame`: Indicates that the decorated class is excluded from the serialized game state.
	* `@excludepropfromsavegame`: Indicates that the decorated class-property is excluded from the serialized game state.
* When introducing new features, consider how they can be serialized and deserialized as part of the game state. Also consider that many objects/properties should be *excluded* from serialization.
* When working on the code file `console_cart_editor.ts`, ensure that the functionality you work on is moved into its own code file, to ensure that the `console_cart_editor.ts` file becomes smaller and more manageable.
* Don't unnecessarily override methods.
* **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance. There are several scratch buffers available in `src/bmsx/core/scratchbuffer.ts` that can be used for temporary data storage to avoid frequent allocations.
