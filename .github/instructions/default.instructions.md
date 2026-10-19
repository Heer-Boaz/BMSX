# Product and internal-documentation ownership

The technical manuals (`docs/manual/catalog.json`) specify the physical BMSX
console, BLua32 and installed BIOS. `docs/architecture.md` is internal software
architecture only; it is not an additional hardware reference. Verify facts
against spec leaves and live owners/BIOS, and report conflicting evidence.
Do not use remembered architecture excerpts as product authority.

`cartlib`, ROM packers, asset converters and project tools are independent studio
software, not console firmware or a manufacturer SDK. Filesystem location does
not determine product ownership. Public manuals explain hardware and BIOS from
the cartridge programmer's perspective, with compact real examples and no
repository, test, emulator or tool-specific assumptions. Keep hardware facts in
the manuals rather than copying them into internal engineering documents.
A cartridge is a physical card, not a linked or compiled program. Distinguish
its ROM/RAM/devices from source programs, executable images and byte contents.
Keep internal documents only for current, unique architectural/operational
value; delete completed plans, handovers, review logs and duplicate fact sheets
instead of archiving them elsewhere. Manual open questions and concise review
evidence live in the existing chapter catalog; tests and commits retain proof.

Coding policies: *no defensive checks, trust the types, trust proper initialization and configuration (thus: no `ensure`), let the code just fail (thus: trust the code and just let runtime errors pop-up)!, and no legacy fallbacks permitted!*

* Ensure that you have the latest version of Node.js installed (preferably v22 or later).
* Install the necessary dependencies by running:
   ```bash
   npm ci
   ```
* Ensure that you have `typescript` installed locally, as it is required for the build process.
* Repository build/run commands are documented in `README.md` and the separate
  development companion. `npm run headless:game -- <cart-folder>` runs existing
  debug artifacts; `npm run headless:forcebuildallrun -- <cart-folder>` explicitly
  rebuilds the host, BIOS and selected cartridge before running. These are
  project-tool workflows, not manufacturer programming requirements.
* **Project Structure**: Understand the overall structure of the project, including key directories and files.
* **No legacy fallback**: Avoid adding legacy code or fallbacks.
* **No defensive coding**: Prevent any bug-concealing techniques, silent failures and defensive coding. For example:
      ```typescript
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
    ```typescript
    private getViewportMetrics(): ViewportMetrics {
        return $.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics(); // Assume all properties and functions exist and work correctly if the code is designed that way. Only use defensive checks if there is a valid reason to believe that the property/function may not exist or work correctly.
    }
    ```

    Also, instead of this:
    ```typescript
    private initializeSomething(): void {
        if (this.isSomethingInitialized) { // Defensive check
            return;
        }
        // ... initialization code ...
        this.isSomethingInitialized = true; // Mark as initialized
    }
    ```
    Do this:
    ```typescript
    private initializeSomething(): void { // Assume this method is only called once
        // ... initialization code ...
    }
    ```
    Also avoid code like this:
    ```typescript
    private doSomething(): void {
        this?.someProperty?.doAction(); // Avoid optional chaining for properties that should always be defined, otherwise it hides potential bugs
    }
    ```
    Instead, do this:
    ```typescript
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
    ```typescript
    private foo(): void {
        if (typeof this.bar === 'function') {
            this.bar(); // Defensive check for function existence
        }
    }
    ```
    Instead, do this:
    ```typescript
    private foo(): void {
        this.bar(); // Assume bar() always exists
    }
    ```

    Instead of this:
    ```typescript
    if (typeof this.onSomething === 'function')
    ```

    do this:
    ```typescript
    this.onSomething();
    ```

    Also avoid code like this:
    ```typescript
    function dumbDefensiveFunction(value: string[]): string[] | null {
        // (...)
        return (value && value.length > 0) ? value : null; // Prevents allowing checks for undefined or empty arrays. Also, why even check for an empty array? Just return the empty array or never call this function with an empty array!
    }
    ```
    Instead, do this:
    ```typescript
    function smartFunction(value: string[]): string[] {
        // (...)
        return value; // Assume value is always a valid, non-empty array, or handle empty arrays as needed without returning null
    }
    ```
    Another example for the same:
    ```typescript
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
    ```typescript
    function ensureActiveCodeTabMatchesLuaSources(): void {
        const context = getActiveCodeTabContext();
        const activePath = context?.descriptor?.path;
        if (activePath && $.luaSources.path2lua[activePath]) {
            return;
        }
        // (...)
        openLuaCodeTab({ path: entryPath, type: 'lua', asset_id: entryAsset.resid });
    }
    ```

    Also avoid code like this:
    ```typescript
    function anotherDumbDefensiveFunction(num: number): number {
        // (...)
        const defensiveBla = bla ?? null; // What is the point of this? Just use bla directly! If bla is undefined, let it be undefined! Don't be afraid of using truthy checks!
        return defensiveBla;
    }
    ```

    Of course, there are valid cases for defensive coding:
    ```typescript
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
    ```typescript
    function getConfigValue(key: string): string {
        const value = this.config[key];
        if (value === undefined) {
            throw new Error(`Configuration key "${key}" is missing.`); // Valid defensive coding: throw an error if a required configuration key is missing
        }
        return value;
    }
    ```
    or this:
    ```typescript
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
    ```typescript
    function doSomethingComplexWithOptionalParam(param?: SomeType): void {
        if (param) {
            // Handle the case where param is provided
        } else {
            // Handle the case where param is not provided
        }
    }
    ```
* Don't worry about indentation styles. I will take care of formatting the code using Prettier before committing.
* `clamp` is a utility function available that you can find in the folder `/machine/ts/common/`; use it instead of writing your own!
* Scratch buffers are available in `/machine/ts/common/scratchbuffer.ts`; use them for temporary data storage instead of allocating new arrays or buffers.
* Look at other utility functions available in `/machine/ts/common/` before writing your own utility functions!
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
* When working on the code file `cart_editor.ts`, ensure that the functionality you work on is moved into its own code file, to ensure that the `cart_editor.ts` file becomes smaller and more manageable.
* Don't unnecessarily override methods.
* **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance. There are several scratch buffers available in `machine/ts/common/scratchbuffer.ts` that can be used for temporary data storage to avoid frequent allocations.
