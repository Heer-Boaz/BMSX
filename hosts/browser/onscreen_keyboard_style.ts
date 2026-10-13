/** The browser owns CSS-client touch affordances independently of guest video pixels. */
export const BROWSER_ONSCREEN_KEYBOARD_STYLE = `
.bmsx-touch-keyboard-visible #player-surface { z-index: 11000; }
.bmsx-touch-keyboard-visible #controller-viewport { visibility: hidden; }
.bmsx-touch-keyboard {
	position: absolute;
	left: max(4px, env(safe-area-inset-left));
	right: max(4px, env(safe-area-inset-right));
	bottom: max(8px, env(safe-area-inset-bottom));
	max-width: 780px;
	margin-inline: auto;
	padding: 8px;
	box-sizing: border-box;
	z-index: 11000;
	background: #151a22;
	border-radius: 12px;
	font-family: system-ui, sans-serif;
	--keyboard-key-height: 48px;
	--keyboard-row-gap: 6px;
	--keyboard-slot-padding: 2px;
	touch-action: none;
	-webkit-user-select: none;
	user-select: none;
}
.bmsx-touch-keyboard[hidden], .bmsx-touch-keyboard-page[hidden] { display: none; }
.bmsx-touch-keyboard-toolbar {
	display: flex;
	height: 44px;
	gap: 4px;
	margin-bottom: 8px;
}
.bmsx-touch-keyboard-tab, .bmsx-touch-keyboard-close {
	flex: 1 1 0;
	min-width: 44px;
	border: 1px solid #404b5a;
	border-radius: 8px;
	padding: 0 8px;
	font: 500 14px system-ui, sans-serif;
	color: #d0d8e2;
	background: #222a36;
}
.bmsx-touch-keyboard-tab[aria-pressed="true"] { background: #244b66; border-color: #70a6cd; }
.bmsx-touch-keyboard-close { flex: 0 0 64px; }
.bmsx-touch-keyboard-row {
	display: flex;
	justify-content: center;
	width: calc(100% * var(--row-units) / var(--page-units));
	height: var(--keyboard-key-height);
	margin-inline: auto;
}
.bmsx-touch-keyboard-row + .bmsx-touch-keyboard-row { margin-top: var(--keyboard-row-gap); }
.bmsx-touch-keyboard-slot {
	flex: 0 0 calc(100% * var(--key-span) / var(--row-units));
	min-width: 0;
	padding-inline: var(--keyboard-slot-padding);
	box-sizing: border-box;
}
.bmsx-touch-key {
	display: block;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	padding: 0;
	border: 1px solid #465264;
	border-radius: 7px;
	background: #283342;
	color: #f0f4fa;
	font: 500 18px system-ui, sans-serif;
	touch-action: none;
}
.bmsx-touch-key[data-wide-label="true"] { font-size: 12px; }
.bmsx-touch-key[data-selected="true"] { border-color: #7eb4d9; background: #26465d; }
.bmsx-touch-key[data-highlighted="true"] { border-color: #ffe09a; background: #f0c15f; color: #191b20; }
@media (min-width: 600px) and (min-height: 500px) {
	.bmsx-touch-keyboard { --keyboard-key-height: 56px; --keyboard-row-gap: 8px; }
	.bmsx-touch-key { font-size: 21px; }
	.bmsx-touch-key[data-wide-label="true"] { font-size: 14px; }
}
@media (max-height: 280px) {
	.bmsx-touch-keyboard {
		bottom: env(safe-area-inset-bottom);
		padding: 4px;
		--keyboard-key-height: 44px;
		--keyboard-row-gap: 3px;
		--keyboard-slot-padding: 1.5px;
	}
	.bmsx-touch-keyboard-toolbar { margin-bottom: 0; }
}
`;
