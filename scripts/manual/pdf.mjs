import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

export const manualLinkBase = 'https://bmsx-manual.invalid/';

export async function finishManualPdf(bytes, headingTargets) {
	const document = await PDFDocument.load(bytes, { updateMetadata: false });
	const directDestinations = document.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
	const nativeDestinationNames = new Map(directDestinations === undefined ? [] :
		directDestinations.keys().map(name => [decodeURIComponent(name.decodeText()), name]));
	const destinations = new Map();
	let headingIndex = 0;
	function visitOutlines(first) {
		let item = first;
		while (item !== undefined) {
			const targets = headingTargets[headingIndex];
			// Outline positions follow paginated headings; empty native anchors do not.
			const destination = item.get(PDFName.of('Dest'));
			for (const id of targets) {
				destinations.set(id, destination);
				const nativeName = nativeDestinationNames.get(id);
				if (nativeName !== undefined) directDestinations.set(nativeName, destination);
			}
			headingIndex += 1;
			const child = item.lookupMaybe(PDFName.of('First'), PDFDict);
			if (child !== undefined) visitOutlines(child);
			item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
		}
	}
	const outlines = document.catalog.lookup(PDFName.of('Outlines'), PDFDict);
	visitOutlines(outlines.lookup(PDFName.of('First'), PDFDict));

	const entries = document.context.obj([]);
	for (const id of [...destinations.keys()].sort()) {
		entries.push(PDFHexString.fromText(id));
		entries.push(destinations.get(id));
	}
	let names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
	if (names === undefined) {
		names = document.context.obj({});
		document.catalog.set(PDFName.of('Names'), names);
	}
	names.set(PDFName.of('Dests'), document.context.obj({ Names: entries }));

	for (const page of document.getPages()) {
		const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
		if (annotations === undefined) continue;
		for (let index = 0; index < annotations.size(); index += 1) {
			const annotation = annotations.lookup(index, PDFDict);
			const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
			if (action === undefined || action.lookup(PDFName.of('S'), PDFName) !== PDFName.of('URI')) continue;
			const uri = action.lookup(PDFName.of('URI'), PDFString, PDFHexString).decodeText();
			if (uri.startsWith(manualLinkBase)) {
				// PDF viewers can treat a bare dotted filename as a hostname.
				// Emit an explicit relative path, not an ambiguous scheme-less URL.
				action.set(PDFName.of('URI'), PDFString.of(`./${uri.slice(manualLinkBase.length)}`));
			}
		}
	}
	return document.save({ useObjectStreams: false });
}
