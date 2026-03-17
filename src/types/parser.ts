/**
 * Unified parser types — single source of truth for all parser-related interfaces.
 *
 * Re-exports domain types and adds strict typing (e.g. FileFormat)
 * so that TypeScript catches format mismatches at compile time.
 */

// Re-export FileFormat and utilities from the canonical source
export type { FileFormat } from "@/lib/fileFormatUtils";
export {
  detectFileFormat,
  getSourcePath,
  findSourceBlob,
  stripFileExtension,
  getMimeType,
} from "@/lib/fileFormatUtils";

// Re-export all parser page types
export type {
  Scene,
  Chapter,
  Part,
  BookStructure,
  SectionType,
  TocChapter,
  Step,
  ChapterStatus,
  BookRecord,
  CharacterAppearance,
  LocalCharacter,
} from "@/pages/parser/types";

export {
  classifySection,
  normalizeLevels,
  SECTION_ICONS,
  SCENE_TYPE_COLORS,
  NAV_WIDTH_KEY,
  ACTIVE_BOOK_KEY,
  NAV_STATE_KEY,
} from "@/pages/parser/types";

// Re-export project storage types
export type { ProjectStorage, ProjectMeta, StorageBackend } from "@/lib/projectStorage";
export { PROJECT_META_VERSION, detectStorageBackend } from "@/lib/projectStorage";

// Re-export local sync types
export type { LocalBookStructure, LocalChapterData } from "@/lib/localSync";
