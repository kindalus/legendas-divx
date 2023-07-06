import { MediaMetadata } from "./media_file_parser.ts";

export function fullMatch(metadata: MediaMetadata, target: string) {
	return target.includes(metadata.title);
}

export function partialMatch(metadata: MediaMetadata, filename: string) {
	const re = `${metadata.shortTitle.replace(/\s/g, ".")}.*${metadata.release}`;
	return new RegExp(re, "i").test(filename);
}
