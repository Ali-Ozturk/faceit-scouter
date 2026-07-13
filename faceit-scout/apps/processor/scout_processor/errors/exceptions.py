from enum import StrEnum


class ErrorCode(StrEnum):
    UNSUPPORTED_FILE = "UNSUPPORTED_FILE"
    FILE_NEVER_STABILIZED = "FILE_NEVER_STABILIZED"
    FILE_CLAIM_FAILED = "FILE_CLAIM_FAILED"
    CHECKSUM_FAILED = "CHECKSUM_FAILED"
    DUPLICATE_FILE = "DUPLICATE_FILE"
    DECOMPRESSION_FAILED = "DECOMPRESSION_FAILED"
    PARSER_FAILED = "PARSER_FAILED"
    PARSED_DATA_INVALID = "PARSED_DATA_INVALID"
    DATABASE_PERSISTENCE_FAILED = "DATABASE_PERSISTENCE_FAILED"
    FILE_MOVE_FAILED = "FILE_MOVE_FAILED"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"


class ProcessingError(Exception):
    def __init__(self, code: ErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
