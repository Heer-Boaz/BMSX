import type { StudioSourceContext } from '../../hosts/common/studio_projects';

/** Browser-owned source admission. Folder selection is metadata; the durable UUID is the identity. */
export function resolveBrowserSourceContext(projectRoot: string): Promise<StudioSourceContext> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('bmsx-studio-source-contexts', 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('contexts', { keyPath: 'id' });
			request.result.createObjectStore('sourceOpenSelections');
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			database.onversionchange = () => database.close();
			const transaction = database.transaction(['contexts', 'sourceOpenSelections'], 'readwrite');
			const contexts = transaction.objectStore('contexts'), selections = transaction.objectStore('sourceOpenSelections');
			let context: StudioSourceContext;
			transaction.onabort = () => { database.close(); reject(transaction.error); };
			transaction.oncomplete = () => { database.close(); resolve(context); };
			const selection = selections.get(projectRoot);
			selection.onsuccess = () => {
				const id: string | undefined = selection.result;
				if (id === undefined) {
					context = { id: crypto.randomUUID(), projectRoot };
					contexts.add(context);
					selections.add(context.id, projectRoot);
				} else {
					const selected = contexts.get(id);
					selected.onsuccess = () => { context = selected.result; };
				}
			};
		};
	});
}
