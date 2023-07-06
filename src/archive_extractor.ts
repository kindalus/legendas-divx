import { MediaMetadata } from "./media_file_parser.ts";

export type ArchiveExtractorFn = (metadata: MediaMetadata, filename: string) => Promise<void>;
