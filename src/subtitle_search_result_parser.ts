import { MediaMetadata } from "./media_file_parser.ts";
import { fullMatch, partialMatch } from "./media_matchers.ts";
import { Options } from "./options.ts";

const TRUSTED_USERS = ["arlequim93", "razor2911"];
const SUBTITLE_RE =
	/User_Info&username=(\w+).*?<img id="capa_grande.*?<center>(.*?)<\/center>.*?href="(modules\.php\?name=Downloads&d_op=getit&lid=.*?)"/;

export interface SubtitleCandidate {
	user: string;
	rank: number;
	desc: string;
	url: string;
}

export interface SearchResults {
	metadata: MediaMetadata;
	hits: SubtitleCandidate[];
	partialHits: SubtitleCandidate[];
	others: SubtitleCandidate[];
}

export function parseSearchResult(
	metadata: MediaMetadata,
	rawHtml: string,
	opts?: Options
): SearchResults {
	const subsSections = rawHtml.replace(/\n/g, "").match(new RegExp(SUBTITLE_RE, "g"));

	if (opts?.verbose) {
		console.log("Subtitles Sections:", subsSections);
	}

	const results = emptyResults(metadata);

	if (!subsSections) {
		return results;
	}

	subsSections.reduce((acc, section) => {
		const candidate = candidateFromSection(section);

		if (fullMatch(metadata, candidate.desc)) {
			acc.hits.push(candidate);
			return acc;
		}

		if (partialMatch(metadata, candidate.desc)) {
			acc.partialHits.push(candidate);
			return acc;
		}

		acc.others.push(candidate);
		return acc;
	}, results);

	return {
		metadata: results.metadata,
		hits: results.hits.sort((a, b) => b.rank - a.rank),
		partialHits: results.partialHits.sort((a, b) => b.rank - a.rank),
		others: [...results.others],
	};
}

function emptyResults(metadata: MediaMetadata) {
	return {
		metadata,
		hits: new Array<SubtitleCandidate>(),
		partialHits: new Array<SubtitleCandidate>(),
		others: new Array<SubtitleCandidate>(),
	};
}

function candidateFromSection(section: string): SubtitleCandidate {
	const subtitleDesc = section.match(SUBTITLE_RE)!;

	return {
		user: subtitleDesc[1],
		rank: TRUSTED_USERS.some((user) => user === subtitleDesc[1]) ? 12 : 5,
		desc: subtitleDesc[2].replace(/(<.+?>)+/g, "\n"),
		url: subtitleDesc[3],
	};
}
