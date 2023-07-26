import { DOMParser, Node } from "../deps.ts";
import { MediaMetadata } from "./media_file_parser.ts";
import { fullMatch, partialMatch } from "./media_matchers.ts";

const TRUSTED_USERS = ["arlequim93", "razor2911"];
// const SUBTITLE_RE =
// 	/User_Info&username=(\w+).*?<img id="capa_grande.*?<center>(.*?)<\/center>.*?href="(modules\.php\?name=Downloads&d_op=getit&lid=.*?)"/;

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

export function parseSearchResult(metadata: MediaMetadata, rawHtml: string): SearchResults {
	const subsNodes = extractSubtitlesNodes(rawHtml);

	const results = emptyResults(metadata);

	subsNodes.reduce((acc, node) => {
		const candidate = candidateFromNode(node);

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

function candidateFromNode(node: Node): SubtitleCandidate {
	const root = node.firstChild;
	//@ts-ignore deno not recognizing innerHTML and innerText
	const user = root.firstChild.innerHTML.match(/User_Info&amp;username=(\w+)/)![1];
	//@ts-ignore deno not recognizing innerHTML and innerText
	const userRank = root.childNodes[1].lastChild.innerHTML.match(/rank(\d+).gif/)?.[1];

	return {
		user,
		rank: TRUSTED_USERS.some((u) => u === user) ? 10 : userRank ? parseInt(userRank) : 5,
		//@ts-ignore deno not recognizing innerHTML and innerText
		desc: root.childNodes[3].childNodes[1].innerText,
		//@ts-ignore deno not recognizing innerHTML and innerText
		url: root.lastChild.innerHTML
			.match(/href="(modules\.php\?nam.*?)"/)[1]
			.replace(/&amp;/g, "&"),
	};
}

function extractSubtitlesNodes(html: string): Node[] {
	const parser = new DOMParser();

	const doc = parser.parseFromString(html, "text/html")!;
	if (!doc) {
		return [];
	}

	const els = doc.querySelectorAll("table.forumborder2");
	if (els.length <= 3) {
		return [];
	}

	const nodes = [];

	for (let i = 1; i < els.length - 2; i++) {
		nodes.push(els[i]);
	}

	return nodes;
}
