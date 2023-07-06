import { fs, parse } from "./deps.ts";

import { LegendasDivxClient } from "./src/legendas_divx_client.ts";
import { MediaMetadata, parseMediaFilename } from "./src/media_file_parser.ts";
import { SearchResults, parseSearchResult } from "./src/subtitle_search_result_parser.ts";
import { extractZip } from "./src/zip_extractor.ts";
import { extractRar } from "./src/rar_extractor.ts";

async function main(username: string, password: string, files: string[]) {
	const client = new LegendasDivxClient(parseSearchResult, extractZip, extractRar);
	await client.login(username, password);

	const results = await searchForSubtitles(client, files);

	const { noResults, withResults, otherResults } = splitResults(results);

	printNoResults(noResults);
	printOtherResults(otherResults);

	await Promise.all(withResults.map((r) => toDownloadPromise(client, r)));
}

async function toDownloadPromise(client: LegendasDivxClient, result: SearchResults): Promise<void> {
	const url = result.hits[0]?.url ?? result.partialHits[0].url;
	const optimal = result.hits[0]?.url ? true : false;

	await client.downloadSubs(result.metadata, url);

	console.log(`${result.metadata.rawTitle}\t\t[${optimal ? "optimal" : "partial match"}]`);
}

function printNoResults(noResults: SearchResults[]) {
	if (noResults.length === 0) {
		return;
	}

	console.log("\nNo results found for the following files:");
	noResults.forEach((result) => console.log(result.metadata.rawTitle));
	console.log("--------------------------------------------------");
}

function printOtherResults(withResults: SearchResults[]) {
	if (withResults.length === 0) {
		return;
	}

	console.log("\nNon optimal subtitles found for the following files:");
	withResults.forEach((result) => {
		console.log(result.metadata.rawTitle);
		console.log(
			result.others
				.map((other) => new URL(other.url, LegendasDivxClient.DOWNLOADS_URL).toString())
				.join("\n")
		);
		console.log("--------------------------------------------------");
	});
}

function splitResults(results: SearchResults[]) {
	const noResults = results.filter(
		(result) =>
			result.hits.length === 0 &&
			result.partialHits.length === 0 &&
			result.others.length === 0
	);

	const withResults = results.filter(
		(result) => result.hits.length > 0 || result.partialHits.length > 0
	);

	const otherResults = results.filter(
		(result) =>
			result.hits.length === 0 && result.partialHits.length === 0 && result.others.length > 0
	);

	return { noResults, withResults, otherResults };
}

function nonExistingSubtitles(filename: string): boolean {
	const subtitleFilename = filename.replace(/\.[^.]+$/, ".srt");
	return !fs.existsSync(subtitleFilename);
}

async function searchForSubtitles(
	client: LegendasDivxClient,
	files: string[]
): Promise<SearchResults[]> {
	const parsedFiles = files
		.map(parseMediaFilename)
		.filter((f) => f !== undefined) as MediaMetadata[];

	const resultPromises = parsedFiles.map((metadata) => client.searchSubtitles(metadata));

	const results = await Promise.all(resultPromises);

	return results;
}

// Get username and password from environment variables
const username = Deno.env.get("LEGENDAS_DIVX_USERNAME")!;
const password = Deno.env.get("LEGENDAS_DIVX_PASSWORD")!;

// Exit if username or password are not set
if (!username || !password) {
	console.error("Username or password not set");
	Deno.exit(1);
}

// Parse CLI arguments
const args = parse(Deno.args, {
	alias: { h: "help", f: "force" },
});

if (args.help) {
	console.log("Usage: legendas-divx.js [-f|-h] files...");
	Deno.exit(0);
}

const force = args.force ?? false;
const files = force ? (args._ as string[]) : (args._ as string[]).filter(nonExistingSubtitles);

// Exit if no files were passed
if (files.length === 0) {
	console.error("No files to process");
	Deno.exit(1);
}

main(username, password, files);
