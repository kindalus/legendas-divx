import { MediaMetadata, isMovie } from "./media_file_parser.ts";
import { SearchResults } from "./subtitle_search_result_parser.ts";
import { ArchiveExtractorFn } from "./archive_extractor.ts";
import { Options } from "./options.ts";

const DOWNLOADS_URL = "https://www.legendasdivx.pt";
const LOGIN_URL = "https://www.legendasdivx.pt/forum/ucp.php?mode=login";
const SEARCH_URL = "https://www.legendasdivx.pt/modules.php?name=Downloads&d_op=search&query=";
const CLEAR_SESSION_URL = "https://www.legendasdivx.pt/sair.php?referer=login";

const SUBTITLES_CONTENT_TYPES: Record<string, string> = {
	"application/x-rar-compressed": "rar",
	"application/zip": "zip",
	"text/html": "html",
};

export type ParseResultsFn = (metadata: MediaMetadata, rawHtml: string) => SearchResults;

export class LegendasDivxClient {
	static readonly DOWNLOADS_URL = DOWNLOADS_URL;

	#cookies: Record<string, unknown> = {};
	#parseResultsFn: ParseResultsFn;
	#zipExtractorFn: ArchiveExtractorFn;
	#rarExtractorFn: ArchiveExtractorFn;

	constructor(
		parseSearchResult: ParseResultsFn,
		zipExtractorFn: ArchiveExtractorFn,
		rarExtractorFn: ArchiveExtractorFn
	) {
		this.#parseResultsFn = parseSearchResult;
		this.#zipExtractorFn = zipExtractorFn;
		this.#rarExtractorFn = rarExtractorFn;
	}

	#cookie(key: string, value?: string): unknown | undefined {
		if (value) {
			this.#cookies = { ...this.#cookies, [key]: value };
		}

		return this.#cookies[key];
	}

	get #cookiesAsString(): string {
		return Object.entries(this.#cookies)
			.map(([key, value]) => `${key}=${value}`)
			.join("; ");
	}

	async login(username: string, password: string, _opts?: Options) {
		// Faz o login para obter novas cookies se necessário
		// O login é feito em duas etapas, primeiro é um GET para obter os cookies de sessão
		// Depois é feito um POST com os dados de login

		await this.#clearSessionForLogin();
		await this.#loginStage(username, password);
	}

	async downloadSubs(metadata: MediaMetadata, fileUrl: string, _opts?: Options) {
		const url = new URL(fileUrl, DOWNLOADS_URL);

		const headers = new Headers();
		headers.set("Cookie", this.#cookiesAsString);
		headers.set("Connection", "keep-alive");

		const init = {
			headers,
			method: "GET",
		};

		const res = await fetch(url, init).catch((err) => {
			console.log("Error downloading file: ", metadata.rawTitle);
			console.error(err);
		});

		if (!res) {
			return;
		}

		const contentType = res.headers.get("Content-Type")!.match(/(.*?)(;|$)/)![1];

		const ext = SUBTITLES_CONTENT_TYPES[contentType];

		if (!ext) {
			console.error("Content Type not supported: " + res.headers.get("Content-Type"));
			return;
		}

		const filename = Deno.makeTempFileSync({ prefix: "legendas-divx-" });
		const downloadedFile = await res.blob().then((blob) => blob.arrayBuffer());

		const data = new Uint8Array(downloadedFile);
		Deno.writeFileSync(filename, data);

		switch (ext) {
			case SUBTITLES_CONTENT_TYPES["application/x-rar-compressed"]:
				await this.#rarExtractorFn(metadata, filename);
				break;

			case SUBTITLES_CONTENT_TYPES["application/zip"]:
				await this.#zipExtractorFn(metadata, filename);
				break;

			case SUBTITLES_CONTENT_TYPES["text/html"]:
				console.error("------------------------------------------------------------");
				console.error("HTML file saved in: ", filename);
				break;
		}
	}

	async #clearSessionForLogin() {
		const res = await fetch(CLEAR_SESSION_URL, { redirect: "manual" });

		if (res.status !== 200 && res.status !== 302) {
			console.error(res.status);
			throw "Response Status: " + res.status;
		}

		this.#extractCookies(res);

		if (!this.#cookie("PHPSESSID")) {
			throw new Error("Login failed");
		}
	}

	async #loginStage(username: string, password: string) {
		const options = this.#buildLoginRequestOptions(username, password);
		const res = await fetch(LOGIN_URL, options);

		if (res.status !== 200 && res.status !== 302) {
			console.error(res.status);
			throw "Response Status: " + res.status;
		}

		this.#extractCookies(res);

		if (!this.#cookie("phpbb3_2z8zs_sid") || this.#cookie("phpbb3_2z8zs_sid") === 1) {
			throw new Error("Login failed");
		}

		const body = await res.text();

		return body;
	}

	async searchSubtitles(metadata: MediaMetadata, opts?: Options): Promise<SearchResults> {
		const query = this.#buildQuery(metadata);

		if (opts?.verbose) {
			console.log("Searching for: " + query);
		}

		const options = {
			headers: {
				Cookie: this.#cookiesAsString,
			},
		};

		const res = await fetch(SEARCH_URL + query, options);

		if (opts?.verbose) {
			console.log("Request URL: " + res.url);
			console.log("Response status: " + res.status);
		}

		if (res.status !== 200 && res.status !== 302) {
			throw "Response Status: " + res.status;
		}

		const html = await res.text();

		const parsed = this.#parseResultsFn(metadata, html);

		if (opts?.verbose) {
			console.log(
				JSON.stringify(parsed, null, 2)
					.replaceAll(/"desc": "(.*?)"/g, "\nDescrição:\n$1\n**********\n")
					.replaceAll("\\n", "\n")
			);
		}

		return parsed;
	}

	#buildQuery(metadata: MediaMetadata): string {
		const splits = metadata.shortTitle.split(" ");

		splits.push(isMovie(metadata) ? metadata.year : metadata.episode);

		return splits.join(".");
	}

	#buildLoginRequestOptions(username: string, password: string): RequestInit {
		const headers = new Headers();
		headers.append("Cookie", this.#cookiesAsString);

		const urlencoded = new URLSearchParams();
		urlencoded.append("username", username);
		urlencoded.append("password", password);
		urlencoded.append("redirect", "./ucp.php?mode=login");
		urlencoded.append("sid", this.#cookie("phpbb3_2z8zs_sid") as string);
		urlencoded.append("redirect", "index.php");
		urlencoded.append("login", "Ligue-se");

		return {
			method: "POST",
			body: urlencoded,
			headers,
			redirect: "manual",
		};
	}

	#extractCookies(res: Response) {
		const COOKIES_RE = /(.*?expires=.{3},.*?)(,|$)/g;
		const COOKIE_KEY_RE = /(.*?)=(.*?)?;.+expires=(.*?)($|;)/;

		const cString = res.headers.get("set-cookie");

		cString
			?.match(COOKIES_RE)
			?.map((c) => c.match(COOKIE_KEY_RE))
			?.forEach((match) => {
				if (!match) {
					return;
				}

				this.#cookie(match[1].trim(), match[2]);
			});
	}
}
