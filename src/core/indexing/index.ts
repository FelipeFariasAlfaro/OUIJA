export { chunkText, type ChunkOptions } from './chunker'
export { ImageReader, OCR_MAX_BYTES, type ImageReadOptions, type ImageReadProgress, type OcrFn } from './imageReader'
export { IndexPipeline, type IndexFolderOptions, type PipelineDeps } from './pipeline'
export { DEFAULT_EXCLUDED_DIRS, isIndexablePath, scanFolder, statIndexable, type ScanOptions } from './scanner'
export {
  FatalIndexError,
  type ChangeInput,
  type ChangeKind,
  type ChangeSink,
  type Embedder,
  type IndexProgress,
  type IndexReport,
  type ScannedFile,
  type Summarizer
} from './types'
export { watchFolder, type FolderWatcher, type WatchOptions } from './watcher'
