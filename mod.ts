import { fs, parse } from "./deps.ts";

import { LegendasDivxClient } from "./src/legendas_divx_client.ts";
import { MediaMetadata, parseMediaFilename } from "./src/media_file_parser.ts";
import { SearchResults, parseSearchResult } from "./src/subtitle_search_result_parser.ts";
import { extractZip } from "./src/zip_extractor.ts";
import { extractRar } from "./src/rar_extractor.ts";
import { Options } from "./src/options.ts";

export const VERSION = "2023-07-26 09:29";

async function main(username: string, password: string, files: string[], opts?: Options) {
	const client = new LegendasDivxClient(parseSearchResult, extractZip, extractRar);
	await client.login(username, password, opts);

	const results = await searchForSubtitles(client, files, opts);

	const { noResults, withResults, otherResults } = splitResults(results, opts);

	printNoResults(noResults);
	printOtherResults(otherResults);

	await Promise.all(withResults.map((r) => toDownloadPromise(client, r, opts)));
}

async function toDownloadPromise(
	client: LegendasDivxClient,
	result: SearchResults,
	opts?: Options
): Promise<void> {
	const url = result.hits[0]?.url ?? result.partialHits[0].url;
	const optimal = result.hits[0]?.url ? true : false;

	await client.downloadSubs(result.metadata, url, opts);

	console.log(`${result.metadata.rawTitle}\t\t[${optimal ? "optimal" : "partial match"}]`);
}

function printNoResults(noResults: SearchResults[]) {
	if (noResults.length === 0) {
		return;
	}

	console.log("\nNo results found for the following files:");
	console.log("--------------------------------------------------");
	noResults.forEach((result) => console.log(result.metadata.rawTitle));
}

function printOtherResults(withResults: SearchResults[]) {
	if (withResults.length === 0) {
		return;
	}

	console.log("\nNon optimal subtitles found for the following files:");
	withResults.forEach((result) => {
		console.log("--------------------------------------------------");
		console.log(result.metadata.rawTitle);
		console.log(
			result.others
				.map((other) => new URL(other.url, LegendasDivxClient.DOWNLOADS_URL).toString())
				.join("\n")
		);
	});
}

function splitResults(results: SearchResults[], _opts?: Options) {
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
	const exists = fs.existsSync(subtitleFilename);

	if (exists) {
		console.log(`Subtitle '${filename}' exists already, skipping. Use -f to force download.`);
	}

	return !exists;
}

async function searchForSubtitles(
	client: LegendasDivxClient,
	files: string[],
	opts?: Options
): Promise<SearchResults[]> {
	const parsedFiles = files
		.map((v) => parseMediaFilename(v, opts))
		.filter((f) => f !== undefined) as MediaMetadata[];

	const resultPromises = parsedFiles.map((metadata) => client.searchSubtitles(metadata, opts));

	const results = await Promise.all(resultPromises);

	return results;
}

// Get username and password from environment variables
const username = Deno.env.get("LEGENDAS_DIVX_USERNAME")!;
const password = Deno.env.get("LEGENDAS_DIVX_PASSWORD")!;
const DEBUG = Deno.env.get("DEBUG") === "1";

// Exit if username or password are not set
if (!username || !password) {
	console.error("Username or password not set");
	Deno.exit(1);
}

// Parse CLI arguments
const args = parse(Deno.args, {
	alias: { h: "help", f: "force", v: "verbose" },
});

if (args.help) {
	console.log("Version:", VERSION);
	console.log("Usage: legendas-divx.js [-f|-h] [-v] files...");
	Deno.exit(0);
}

const force = args.force ?? false;
const files = force ? (args._ as string[]) : (args._ as string[]).filter(nonExistingSubtitles);

// Exit if no files were passed
if (files.length === 0) {
	console.error("No files to process");
	Deno.exit(1);
}

main(username, password, files, { verbose: (DEBUG || args.verbose) ?? false, dryRun: false });
