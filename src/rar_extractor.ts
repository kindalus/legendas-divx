import { unrar } from "../deps.ts";

import { MediaMetadata } from "./media_file_parser.ts";
import { fullMatch, partialMatch } from "./media_matchers.ts";

export async function extractRar(metadata: MediaMetadata, filename: string): Promise<void> {
	const buf = Deno.readFileSync(filename);
	const extractor = unrar.createExtractorFromData(buf);

	const list = extractor.getFileList();
	if (list[0].state !== "SUCCESS" || !list[1]?.fileHeaders) {
		console.error("Couldn't get file list from file: " + filename);
		return;
	}

	for (const pass of [0, 1, 2]) {
		for (const header of list[1].fileHeaders) {
			if (pass == 2) {
				await extractFile(metadata, extractor, header.name);
				return;
			}

			if (pass === 0 && fullMatch(metadata, header.name)) {
				await extractFile(metadata, extractor, header.name);
				return;
			}

			if (pass === 1 && partialMatch(metadata, header.name)) {
				await extractFile(metadata, extractor, header.name);
				return;
			}
		}
	}
}

// deno-lint-ignore no-explicit-any
function extractFile(metadata: MediaMetadata, extractor: any, headerName: string) {
	const rarFiles = extractor.extractFiles([headerName]);
	if (
		rarFiles[0].state === "SUCCESS" &&
		rarFiles[1] &&
		rarFiles[1].files[0] &&
		rarFiles[1].files[0].extract[1]
	) {
		const dstFile = metadata.path.concat(metadata.rawTitle.slice(0, -3), "srt");

		return Deno.writeFile(dstFile, rarFiles[1].files[0].extract[1]).catch((err) => {
			console.error("Couldn't write file: " + dstFile);
			console.error("Couldn't write file: " + err);
		});
	}

	console.error("Couldn't extract file: " + headerName);
}
