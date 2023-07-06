export interface ShowMetadata extends CommonMetadata {
	readonly episode: string;
}

export interface MovieMetadata extends CommonMetadata {
	readonly year: string;
}

export interface CommonMetadata {
	readonly release: string;
	readonly quality: string;
	readonly shortTitle: string;
	readonly path: string;
	readonly rawTitle: string;
	readonly title: string;
	readonly movie: boolean;
}

export type MediaMetadata = ShowMetadata | MovieMetadata;

export function isMovie(metadata: MediaMetadata): metadata is MovieMetadata {
	return (metadata as MovieMetadata).year !== undefined;
}

export function parseMediaFilename(file: string): MediaMetadata | undefined {
	const indexOf = file.lastIndexOf("/");

	const path = indexOf == -1 ? "./" : file.substring(0, indexOf + 1);
	const rawTitle = indexOf == -1 ? file : file.substring(indexOf + 1);

	const title = rawTitle.match(/(.*?)(-?\[.*?\])?(\.\w{3,})?$/i)![1];
	const titleSplits = title.match(/(.*)\W+(s\d\de\d\d|\d{4}).*?(\d{3,4}p)\.(\w+)/i);

	if (!titleSplits) {
		console.error(`Error parsing title: ${rawTitle}`);
		return;
	}

	const metadata: Partial<CommonMetadata> = {
		path,
		rawTitle,
		title,
		shortTitle: titleSplits[1].replace(/\./g, " ").trim(),
		quality: titleSplits[3] ? titleSplits[3].trim() : "720p",
		release: titleSplits[4].trim(),
	};

	if (titleSplits[2].length === 4) {
		return {
			...metadata,
			year: titleSplits[2].trim(),
			movie: true,
		} as MovieMetadata;
	}

	return {
		...metadata,
		episode: titleSplits[2].trim(),
		movie: false,
	} as ShowMetadata;
}
