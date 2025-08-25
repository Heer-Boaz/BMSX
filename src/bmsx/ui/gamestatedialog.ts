import { $ } from '../core/game';

/**
 * Shows a download dialog for the current save state.
 * The save state is downloaded as a .bmsx file.
 * @returns void
 */
export function show_download_savestate_dialog() {
    const data = $.model.save();

    const a = document.createElement('a');
    a.href = URL.createObjectURL(
        new Blob([data], {
            type: "data:application/json"
        })
    );
    a.download = 'savestate.bmsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

let setload: HTMLInputElement = undefined;

/**
 * Shows a file open dialog with the specified options and attaches the provided event listener to the 'change' event of the input element.
 * @param options - An object containing the options for the file open dialog.
 * @param options.multiple - A boolean indicating whether multiple files can be selected.
 * @param options.accept - A string containing the file types that can be selected.
 * @param options.eventlistener - The event listener to attach to the 'change' event of the input element.
 * @returns void
 */
export function show_openfile_dialog(options: { multiple: boolean, accept: string, eventlistener: (this: HTMLInputElement, ev: Event) => any }) {
    setload = document.createElement('input');
    setload.type = 'file';
    setload.multiple = options.multiple;
    setload.accept = options.accept;
    setload.style.display = 'none';
    setload.click();

    setload.addEventListener('change', options.eventlistener);
}

/**
 * Shows a file open dialog with options to select a single .bmsx file and attaches the `load_savestate` event listener to the 'change' event of the input element.
 * @returns void
 */
export function show_load_savestate_dialog() {
    show_openfile_dialog({ multiple: false, accept: '.bmsx', eventlistener: load_savestate });
}

/**
 * Checks if any files are selected via the file open dialog.
 * @param files - The list of files selected via the file open dialog.
 * @returns A boolean indicating whether any files are selected.
 */
function are_any_files_selected_via_openfile_dialog(files: FileList) {
    return files && files.length !== 0;
}

/**
 * Returns the first selected file from a file list obtained from a file open dialog.
 * If no files are selected, returns undefined.
 * @param files - The list of files selected via the file open dialog.
 * @returns The first selected file, or undefined if no files are selected.
 */
function get_first_selected_file_from_openfile_dialog(files: FileList): File {
    if (!are_any_files_selected_via_openfile_dialog(files)) {
        // Do nothing
        console.info('Geen bestand geselecteerd!');
        return undefined;
    }
    else {
        return files[0];
    }
}

/**
 * Loads a save state from a selected file obtained from a file open dialog.
 * @param this - The HTMLInputElement that triggered the 'change' event.
 * @param ev - The 'change' event that was triggered.
 * @returns void
 */
function load_savestate(this: HTMLInputElement, _ev: Event) {
    const file = get_first_selected_file_from_openfile_dialog(setload.files);
    if (file) {
        file.text().then(result => globalThis.model.load(result));
    }
    setload = undefined;
}
