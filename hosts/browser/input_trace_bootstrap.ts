import { BrowserInputTrace } from './input_trace';

// This separate, tiny entrypoint is present only on the existing /ios/ page.
window.bmsxInputTrace = new BrowserInputTrace(window);
