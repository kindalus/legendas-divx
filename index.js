const fetch = require("node-fetch");
const { URLSearchParams } = require("url");
const fs = require("fs");
const unrar = require("node-unrar-js");
const HOME_DIR = require("os").homedir();
const TMP_DIR = require("os").tmpdir();
const yauzl = require("yauzl");
const path = require("path");
const { exit } = require("process");

const URL_MODULES = "https://www.legendasdivx.pt/modules.php";
const URL_LOGIN = "https://www.legendasdivx.pt/forum/ucp.php?mode=login";
const URL_SEARCH =
	"https://www.legendasdivx.pt/modules.php?name=Downloads&file=jz&d_op=search&op=_jz00";
const TRUSTED_USERS = ["arlequim93", "razor2911"];

const ACCEPTED_FORMATS = [".mkv", ".mp4", ".avi"];
const COOKIES_PATH = path.join(HOME_DIR, "/.legendas-divx-cookies");
var COOKIES = {};

const SUBTITLES_CONTENT_TYPES = {
	"application/x-rar-compressed": "rar",
	"application/zip": "zip",
	"text/html": "html",
};

if (process.argv.length >= 3 && process.argv[2] === "-h") {
	console.log("Usage: legendas-divx.js [-f|-h] files...");
	exit(0);
}

main();

async function main() {
	const files = parseArgsAndDropFilesWithSrt();

	// Obtém os metadados dos vídeos
	const metadata = await parseVideosMetadata(files);

	await authenticate();

	// Faz download dos metadados das legendas
	const subs = await downloadSubsMetadata(metadata);

	// Faz dowload das legendas
	if (subs.length > 0) {
		subs.forEach(downloadSubs);
	}
}

// Processa argumentos de descarta directorias e ficheiros com legendas
function parseArgsAndDropFilesWithSrt() {
	const [, , ...files] = process.argv;

	const force = files[0] === "-f";
	if (force) files.shift();

	const movies = files.filter((file) => {
		if (isAcceptedFormat(file) && (force || !fs.existsSync(file.slice(0, -3) + "srt"))) {
			return true;
		}

		console.error(`Skipping ${file} (Bad Format)`);
		return false;
	});

	return movies;
}

function isAcceptedFormat(file) {
	return ACCEPTED_FORMATS.includes(file.slice(-4));
}

async function authenticate() {
	// Inicializa a ligação para legendasdivx.pt
	// 1. Verifica as cookies no ficheiro ~/.legendas-divx-cookies
	if (fs.existsSync(COOKIES_PATH)) COOKIES = JSON.parse(String(fs.readFileSync(COOKIES_PATH)));
	else COOKIES = {};

	// 2. Faz o login para obter novas cookies se necessário
	let loginFormData = {
		username: process.env.LEGENDAS_DIVX_USERNAME,
		password: process.env.LEGENDAS_DIVX_PASSWORD,
		redirect: "index.php",
		login: "Ligue-se",
	};

	if (COOKIES["phpbb3_2z8zs_sid"]) loginFormData.sid = COOKIES["phpbb3_2z8zs_sid"].value;

	await post(URL_LOGIN, loginFormData);

	if (!COOKIES["phpbb3_2z8zs_sid"] || COOKIES["phpbb3_2z8zs_sid"].value == 1) {
		console.error("Login failed");
		return;
	}

	// 3. Guarda as cookies
	fs.writeFile(COOKIES_PATH, JSON.stringify(COOKIES), (err) => {
		if (err) console.error(err);
	});
}

/**
 *
 * @param {string[]} files
 */
async function parseVideosMetadata(files) {
	let metadata = new Array();

	for (let index = 0; index < files.length; index++) {
		const file = files[index];

		const indexOf = file.lastIndexOf("/");

		if (index > 0) {
			await waitRandomnly();
		}

		const data = {
			path: indexOf == -1 ? "./" : file.substring(0, indexOf + 1),
			rawTitle: indexOf == -1 ? file : file.substring(indexOf + 1),
		};

		data.title = data.rawTitle.match(/(.*?)(-?\[.*?\])?(\.\w{3})?$/i)[1];

		let splits = data.title.match(/(.*)\W+(s\d\de\d\d|\d{4})\.?(\d{3,4}p)?\.(\w+)/i);
		if (splits) {
			data.shortTitle = splits[1].replace(/\./g, " ").trim();
			data.quality = splits[3] ? splits[3].trim() : "720p";
			data.release = splits[4].trim();

			if (splits[2].length == 4) {
				data.year = splits[2].trim();
				data.movie = true;
			} else {
				data.show = true;
				data.episode = splits[2].trim();
			}

			data.query = data.shortTitle.concat(" ", data.show ? data.episode : data.year);

			metadata.push(data);
		} else {
			console.error(`Error parsing title: ${data.rawTitle}`);
		}
	}

	return metadata;
}

function waitRandomnly() {
	const timeout = Math.random() * 30000;

	return new Promise((resolve) => {
		setTimeout(resolve, timeout);
	});
}

async function downloadSubsMetadata(metadata) {
	let newMetadata = new Array();

	for (let i = 0; i < metadata.length; i++) {
		let data = metadata[i];
		let rawHtml = await post(URL_SEARCH, { query: data.query });

		// Uglify
		let hits = new Array();
		let others = new Array();
		let partialHits = new Array();

		let subsSections = rawHtml.replace(/(\s|\n)/g, "").match(/(sub_box.*?sub_details)/g);

		//console.log('------------------------------------------------------------');
		//console.log(data.rawTitle);

		if (subsSections) {
			subsSections.forEach((section) => {
				let aux = section.match(
					/.*?User_Info&username=(\w+).*?td_descbrd_up">(.*?)<\/td>.*?sub_download.*?href="(.*?)"/
				);

				let rank = section.match(/images\/rank(\d+).gif/);

				if (!rank) {
					rank = 5;
				} else {
					rank = Number.parseInt(rank[1]);
				}

				let candidate = {
					user: aux[1],
					rank: TRUSTED_USERS.some((user) => user === aux[1]) ? 12 : rank,
					desc: aux[2].replace(/(<.+?>)+/g, "\n"),
					url: aux[3],
				};

				if (matchFull(data, aux[2])) hits.push(candidate);
				else if (matchPartial(data, aux[2])) partialHits.push(candidate);
				else others.push(candidate);
			});

			data.hits = hits.sort((a, b) => b.rank - a.rank);
			data.partialHits = partialHits.sort((a, b) => b.rank - a.rank);
			data.otherSubs = others;

			newMetadata.push(data);
		} else {
			//console.log('None found');
		}
	}

	return newMetadata;
}

function matchFull(data, candidate) {
	return candidate.match(new RegExp(data.title, "i"));
}

function matchPartial(data, candidate) {
	return candidate.match(new RegExp(`${data.query.replace(/\s/g, ".")}.*?${data.release}`, "i"));
}

function downloadSubs(data) {
	if (data.hits.length == 0 && data.partialHits.length == 0) {
		//console.log('No subtitles found for this release ');
		return;
	}

	let url = data.hits.length > 0 ? data.hits[0].url : data.partialHits[0].url;

	fetch(URL_MODULES.concat(url), {
		headers: { Cookie: cookiesToString(COOKIES) },
	}).then((res) => {
		let ext = SUBTITLES_CONTENT_TYPES[res.headers.get("Content-Type").match(/(.*?)(;|$)/)[1]];

		if (!ext) {
			console.error("Content Type not supported: " + res.headers.get("Content-Type"));
			return;
		}

		const filename = TMP_DIR.concat("/", data.rawTitle.slice(0, -3), ext);
		const dest = fs.createWriteStream(filename);

		res.body.pipe(dest);

		res.body.on("error", (err) => {
			console.error(err);
		});

		dest.on("finish", () => {
			switch (ext) {
				case SUBTITLES_CONTENT_TYPES["application/x-rar-compressed"]:
					extractRar(filename, data);
					break;
				case SUBTITLES_CONTENT_TYPES["application/zip"]:
					extractZip(filename, data);
					break;
				case SUBTITLES_CONTENT_TYPES["text/html"]:
					console.error("------------------------------------------------------------");
					console.error("HTML file saved in: ", filename);
					break;
			}
		});

		dest.on("error", (err) => {
			console.error(err);
		});
	});
}

function extractRar(filename, data) {
	// Read the archive file into a typedArray
	var buf = Uint8Array.from(fs.readFileSync(filename)).buffer;
	var extractor = unrar.createExtractorFromData(buf);

	var list = extractor.getFileList();
	if (list[0].state === "SUCCESS") {
		for (let pass = 0; pass < 3; pass++) {
			for (let i = 0; i < list[1].fileHeaders.length; i++) {
				let match =
					pass == 2
						? true
						: pass == 0
						? matchFull(data, list[1].fileHeaders[i].name)
						: matchPartial(data, list[1].fileHeaders[i].name);

				if (match) {
					let extract = extractor.extractFiles([list[1].fileHeaders[i].name]);

					if (extract[0].state === "SUCCESS") {
						let dstFile = data.path.concat(data.rawTitle.slice(0, -3), "srt");
						let writer = fs.createWriteStream(dstFile);

						writer.write(extract[1].files[0].extract[1], (error) => {
							if (!error) {
								//console.log(list[1].fileHeaders[i].name);
							} else {
								console.error(error);
							}
						});

						writer.on("error", (error) => {
							console.error("Couldn't write to: " + [list[1].fileHeaders[i].name]);
							console.error(error);
						});

						return;
					} else {
						console.error("Couldn't extract: " + list[1].fileHeaders[i].name);
					}
				}
			}
		}
	} else {
		console.error("Couldn't get file list from file: " + filename);
	}
}

function extractZip(filename, data) {
	for (let pass = 0; pass < 3; pass++) {
		yauzl.open(filename, { lazyEntries: true }, (err, zipfile) => {
			if (err) {
				console.error("Couldn' extract: " + filename);
				return;
			}

			zipfile.readEntry();

			zipfile.on("entry", (entry) => {
				if (/\/$/.test(entry.fileName)) {
					// Directory file names end with '/'.
					// Note that entires for directories themselves are optional.
					// An entry's fileName implicitly requires its parent directories to exist.
					zipfile.readEntry();
				} else {
					let match =
						pass == 2
							? true
							: pass === 0
							? matchFull(data, entry.fileName)
							: matchPartial(data, entry.fileName);
					if (match) {
						zipfile.openReadStream(entry, function (err, readStream) {
							if (err) {
								console.error(
									"Couldn' extract: " + filename.concat("/", entry.fileName)
								);
								return;
							}
							readStream.on("end", () => {
								//console.log(entry.fileName);
								return;
							});

							let dstFile = data.path.concat(data.rawTitle.slice(0, -3), "srt");
							readStream.pipe(dstFile);
						});
					} else {
						zipfile.readEntry();
					}
				}
			});
		});
	}
}

async function post(url, data) {
	// post form parameters (x-www-form-urlencoded)
	let form = new URLSearchParams();

	Object.entries(data).forEach(([key, value]) => form.append(key, value));

	let options = {
		method: "POST",
		body: form,
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: cookiesToString(COOKIES),
		},
		redirect: "manual",
	};

	let res = await fetch(url, options);

	if (res.status == 200 || res.status == 302) {
		extractCookies(res);
		return await res.text();
	}

	console.error(res.status);
	throw "Response Status: " + res.status;
}

/**
 *
 * @param {*} res
 */
function extractCookies(res) {
	/**
	 * @type { String }
	 */
	let cString = res.headers.get("set-cookie");

	if (cString) {
		let cArray = cString.match(/(.*?expires=.{3},.*?)(,|$)/g);

		cArray.forEach((cookie) => {
			let aux = cookie.match(/(.*?)=(.*?)?;.+expires=(.*?)($|;)/);

			COOKIES[aux[1].trim()] = {
				value: aux[2],
				expires: aux[3],
			};
		});
	}

	return COOKIES;
}

function cookiesToString(cookies) {
	if (!cookies) return null;

	let cString = "";
	let index = 0;
	for (const key in cookies) {
		if (index > 0) cString += "; ";

		cString += `${key}=${cookies[key].value ? cookies[key].value : ""}`;
		index++;
	}

	return cString === "" ? null : cString;
}
