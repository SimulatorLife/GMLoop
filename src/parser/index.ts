export { Parser } from "./src/index.js";
export type {
    CommentProcessingOptions,
    DocCommentAttachmentOptions,
    LocationMetadataOptions,
    OutputFormatOptions,
    ParserOptions,
    PredictionStrategyOptions
} from "./src/types/parser-types.js";
export {
    DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL,
    DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH,
    DEFAULT_SLL_PREDICTION_MAX_SOURCE_LENGTH,
    defaultParserOptions
} from "./src/types/parser-types.js";
