1. Ensure that you have the latest version of Node.js installed (preferably v22 or later).
2. Install the necessary dependencies by running:
   ```bash
   npm install -D
   ```
3. Ensure that you have `typescript` installed locally, as it is required for the build process.
4. To validate the bmsx package (the game engine), you can run:
   ```bash
   npx tsc --build
   ```
   This will check the TypeScript files for errors without generating any output files, as the `tsconfig.json` is configured to prevent output.
5. It is currently not possible to build any of the games (like `sint2024`, `testrom`) because that requires the use of the `rompacker`-script which cannot be used by Codex or any other AI model yet.