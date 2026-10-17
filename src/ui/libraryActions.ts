import { addImageFromFile, IMAGE_FILES } from '../io/image';
import { pickFile } from '../io/persist';
import { useStore } from '../model/store';
import type { Point } from '../model/types';
import { isLineEntry, LIBRARY, type LibraryEntry } from '../shapes/library';

/** Adds a sidebar entry centered on `at`: a line, an image (via a file picker), or a shape. */
export async function placeEntry(entry: LibraryEntry, at: Point): Promise<void> {
  if (isLineEntry(entry)) {
    useStore.getState().addLine(at, entry.w);
    return;
  }
  if (entry.kind === 'image') {
    const file = await pickFile(IMAGE_FILES);
    if (file) await addImageFromFile(file, at);
    return;
  }
  useStore.getState().addShape(entry, at);
}

/** The entry a digit key places (1 = Rectangle, 2 = Circle, …). */
export const entryForKey = (key: string) => LIBRARY.find((e) => e.shortcut === key);
