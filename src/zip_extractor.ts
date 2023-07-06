import { yauzl } from "../deps.ts";

import { MediaMetadata } from "./media_file_parser.ts";
import { fullMatch, partialMatch } from "./media_matchers.ts";

export function extractZip(metadata: MediaMetadata, filename: string): Promise<void> {
	for (const pass of [0, 1, 2]) {
		// deno-lint-ignore no-explicit-any
		yauzl.open(filename, { lazyEntries: true }, (err: Error, zipfile: any) => {
			if (err) {
				console.error("Couldn' extract: " + filename);
				return;
			}

			zipfile.readEntry();

			zipfile.on("entry", async (entry: { fileName: string }) => {
				if (/\/$/.test(entry.fileName)) {
					// Directory file names end with '/'.
					// Note that entires for directories themselves are optional.
					// An entry's fileName implicitly requires its parent directories to exist.
					zipfile.readEntry();
				} else {
					if (pass == 2) {
						await extractFile(zipfile, entry.fileName, metadata, filename);
						return;
					}

					if (pass === 0 && fullMatch(metadata, entry.fileName)) {
						await extractFile(zipfile, entry.fileName, metadata, filename);
						return;
					}

					if (pass === 1 && partialMatch(metadata, entry.fileName)) {
						await extractFile(zipfile, entry.fileName, metadata, filename);
						return;
					}

					zipfile.readEntry();
				}
			});
		});
	}

	return Promise.resolve();
}

// deno-lint-ignore no-explicit-any
function extractFile(zipfile: any, entryName: string, metadata: MediaMetadata, filename: string) {
	zipfile.openReadStream(
		entryName,
		function (
			err: Error,
			readStream: {
				on: (arg0: string, arg1: () => void) => void;
				pipe: (arg0: string) => void;
			}
		) {
			if (err) {
				console.error("Couldn' extract: " + filename.concat("/", entryName));
				return;
			}

			readStream.on("end", () => undefined);

			const dstFile = metadata.path.concat(metadata.rawTitle.slice(0, -3), "srt");

			readStream.pipe(dstFile);
		}
	);
}
