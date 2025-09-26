*. Ensure that you have the latest version of Node.js installed (preferably v22 or later).
*. Install the necessary dependencies by running:
   ```bash
   npm install -D
   ```
*. Ensure that you have `typescript` installed locally, as it is required for the build process.
*. To validate the bmsx package (the game engine), you can build the game engine by running:
   ```bash
   npm run validate:engine
   ```
   or to validate both the engine and the scripts, run:
   ```bash
   npm run validate:engine:scripts
   ```
   This will check the TypeScript files for errors and generate the output files `./src/bmsx/bmsx.d.ts` and `./src/bmsx/bmsx.js`.

*  Building the testrom requires:
   ```bash
   npm run pack:build:game testrom
   ```
   Building any other rompack (game) requires:
   ```
   npm run pack:build:game <romname>
   ```
   This command will pack the resources and build the specified rompack (game). The built rompack will be available in the `dist` directory.
   > Important: The given <romname> must match the name of a directory under `./src/` that contains a `res` subdirectory with the resources for that rompack (game). For example, for the `testrom`, the resources should be located in `./src/testrom/res`. However, the result romfile will be named based on the rommanifest.json file inside the `res` directory!! For example, if the `rommanifest.json` file specifies the name as `yiear`, the resulting romfile will be named `yiear.rom` (or `yiear.debug.rom`) even if the directory is named `ella2023`!

   * Use `npm run pack:game <romname>` to only pack the resources without building the rompack.
   * Use `npm run build:game <romname>` to build the rompack without packing the resources *(debug version)*.
   * Use `npm run build:game:force <romname>` to force re-building the rompack *(debug version)*.
   * Use `npm run build:game:production <romname>` to build a production version of the rompack (game) without debug information and with optimizations enabled.
   * Use `npm run build:game:production:force <romname>` see above, but force re-building the rompack.
   * Use `npm run pack:engine` to create a tarball of the bmsx package (the game engine). The tarball will be created in the current directory. This is useful for pinning a specific version of the engine in a rompack's `package.json` file.
   * Use `npm run serve:dist` to serve the contents of the `dist` directory on `http://localhost:8080`. This is useful for testing the built rompacks (games) in a web browser.
   * Use `npm run serve:dist:wsl` to serve the contents of the `dist` directory on `http://<WSL_IP_ADDRESS>:8080`. This is useful for testing the built rompacks (games) in a web browser from Windows when using WSL.
   * Use `npm run fix:indent` to fix the indentation of all TypeScript files in the `src` and `scripts` directories.
   * Use `npm run check:indent` to check the indentation of all TypeScript files in the `src` and `scripts` directories.

   > Important: It is not required to make changes to the `resourceids.ts`-file in the rompack projects! The `pack:game` command will generate the `resourceids.ts` file automatically. This is required when you add or modify resources in the `res` directory, because the `resourceids.ts` is used by the rompack!
   > Note: The `pack:build:game` command will skip type-checking of the game source files for performance reasons. It is assumed that the game source files are already type-checked. If you want to type-check the game source files, you can run `npm run validate:engine:scripts` before running the `pack:build:game` command.
   > Note: Resources for debug and production builds are the same and no separate pack is needed. The build command will use the same packed resources for both debug and production builds.

*. **Project Structure**: Understand the overall structure of the project, including key directories and files.
  - Only accept very strict, explicit coding practices. Keep things straightforward by providing code patches without optional chaining, type erasure, or any bug-concealing techniques. The goal is to design explicit interfaces, avoiding optional fields or dynamic checks, and ensuring compile-time correctness at all times. Follow this approach with minimalism.
  - Don't introduce `as any` casts or `<any>` type assertions.
  - NO SILENT FAILURES!! If something is not supposed to be undefined, don't let it be undefined. Throw an error instead.
  - Don't introduce `?.` or `??` or `if (x === undefined)` checks for properties that **should** always defined! THESE ARE BUGS! Fix the root cause instead OR JUST LET IT CRASH!!
8. **File Naming Conventions**: Follow consistent naming conventions for files and classes. Use PascalCase for class names and lowercase for file names.
9. **Best-practices more important than backwards compatibility**: Feel free to make breaking changes if necessary, but document them clearly.
10. **What would Unreal Engine or Unity do?**: When coding, consider how similar problems are solved in game development environments like Unreal Engine or Unity.
11. **Coding Standards**:
  - Follow established coding standards and best practices for TypeScript development.
  - Assume that I am the only developer. There are no other users or developers of the game engine.
  - Try to move boilerplate code into reusable functions or classes of the core game engine codefiles.
  - Don't use `require` in non-script code (e.g. `rompacker-core.ts` and `rominspector.ts` can have `require`, but core engine files or game source files cannot).
  - Don't assert whether a property is of type function like `if (typeof this.onSomething === 'function') this.onSomething()`, instead, use optional chaining like `this.onSomething?.()`.
  - Don't code any utility without first checking if a similar utility already exists in the codebase. Look under `src/bmsx/utils` and `src/bmsx/core`!!
  - Avoid direct references to WorldObjects or Components. Rather, use the `World`-class (e.g. `$.getGameObject` or `$.getFromCurrentSpace`, `$.get`).
  - Don't introduce circular dependencies.
  - Don't introduce unused variables.
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
  - Don't introduce code that is based on assumptions about the game state or the behavior of other systems. Always use the provided APIs and abstractions to interact with the game world.
12. **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance.
  - Use in-place algorithms and data structures to reduce memory overhead and improve cache locality.
  - Prevent unnecessary allocations by reusing existing objects and buffers.
