*. Ensure that you have the latest version of Node.js installed (preferably v22 or later).
*. Install the necessary dependencies by running:
   ```bash
   npm install -D
   ```
*. Ensure that you have `typescript` installed locally, as it is required for the build process.
*. To validate the bmsx package (the game engine) and to verify the game roms running on the bmsx package, you can build the game engine, scripts, and game roms by running:
   ```bash
   npm run headless:game <gameromname> # WARNING: `<gameromname>` must be replaced with the folder name of the rompack (game) you want to test, e.g. `ella2023` or `testrom`! This is different from the rom name specified in the `rommanifest.json` file inside the `res` directory! The `rominspector` tool uses the rom name specified in the `rommanifest.json` file, so that is different from this!
   ```
   This command will pack the resources and build the specified rompack (game). The built rompack will be available in the `dist` directory. It will also run the rompack in a headless mode (without a graphical interface) to validate that it works correctly. If there are any errors during the build or runtime, they will be displayed in the console.
   > Important: The given <romname> must match the name of a directory under `./src/` that contains a `res` subdirectory with the resources for that rompack (game). For example, for the `testrom`, the resources should be located in `./src/testrom/res`. However, the result romfile will be named based on the rommanifest.json file inside the `res` directory!! For example, if the `rommanifest.json` file specifies the name as `yiear`, the resulting romfile will be named `yiear.rom` (or `yiear.debug.rom`) even if the directory is named `ella2023`!

*. **Project Structure**: Understand the overall structure of the project, including key directories and files.
8. **File Naming Conventions**: Follow consistent naming conventions for files and classes. Use PascalCase for class names and lowercase for file names.
9. **Best-practices more important than backwards compatibility**: Feel free to make breaking changes if necessary, but document them clearly.
10. **What would Unreal Engine or Unity do?**: When coding, consider how similar problems are solved in game development environments like Unreal Engine or Unity.
11. **Coding Standards**:
  - Only accept very strict, explicit coding practices. Keep things straightforward by providing code patches without optional chaining, type erasure, or any bug-concealing techniques. The goal is to design explicit interfaces, avoiding optional fields or dynamic checks, and ensuring compile-time correctness at all times. Follow this approach with minimalism.
  - Don't introduce `as any` casts or `<any>` type assertions when not absolutely necessary.
  - NO SILENT FAILURES!! If something is not supposed to be undefined, don't let it be undefined. Throw an error instead.
  - Don't introduce `?.` or `??` or `if (x === undefined)` checks for properties that **should** always be populated! THESE ARE BUGS! Fix the root cause instead OR JUST LET IT CRASH!!
  - Don't introduce code like `if (typeof this.onSomething === 'function') this.onSomething()`.
  - Don't introduce circular dependencies.
  - Don't introduce unused variables.
  - Don't code any utility without first checking if a similar utility already exists in the codebase. Look under `src/bmsx/utils` and `src/bmsx/core`!!
  - Avoid direct references to WorldObjects or Components. Rather, use the `World`-class (e.g. `$.getGameObject` or `$.getFromCurrentSpace`, `$.get`).
  - Don't use `require` in non-script code (e.g. `rompacker-core.ts` and `rominspector.ts` can have `require`, but core engine files or game source files cannot).
  - Ensure that registry persistent objects are not serialized.
  - Use the annotations provided in the codebase to maintain consistency, these include:
	- `@attach_components`: Indicates that the decorated class should have `Component`s automatically attached.
	- `@update_tagged_components`: Indicates that the decorated function should update all its components that are subscribed to one or more given tags.
	- `@build_fsm`: Indicates that the decorated function should build a finite state machine (FSM) for the associated class. Note that, when using this decorator, the instances of the class will be automatically assigned the FSM, as long as no arguments are passed to the decorator.
	- `@assign_fsm`: Indicates that the decorated class should be assigned an existing FSM with the given ID.
	- `@onsave`: Indicates that the decorated function should be called when the object is saved.
	- `@onload`: Indicates that the decorated function should be called when the object is loaded.
	- `@insavegame`: Indicates that the decorated class is included in the serialized game state.
	- `@excludefromsavegame`: Indicates that the decorated class is excluded from the serialized game state.
	- `@excludepropfromsavegame`: Indicates that the decorated class-property is excluded from the serialized game state.
  - Don't introduce any game logic in `game.ts`, instead, place it in appropriate systems or components. High-level game logic should be invoked from `World.run`.
  - Ensure that any new render logic is implemented in the rendering system, and not directly in the game logic files.
  - Ensure that any debugging UI or features are implemented in the debugging system (e.g. `bmsxdebugger.ts`).
  - When introducing new features, consider how they can be serialized and deserialized as part of the game state. Also consider that many objects/properties should be *excluded* from serialization.
  - Don't unnecessarily override methods.
12. **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance. There are several scratch buffers available in `src/bmsx/core/scratchbuffer.ts` that can be used for temporary data storage to avoid frequent allocations.
