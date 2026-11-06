import { readFileSync } from 'node:fs';

// Unbundled Node tools read the same binary asset that product builds embed.
export default readFileSync(new URL('../fonts/jetbrains_mono/scalable_font.rgba', import.meta.url));
