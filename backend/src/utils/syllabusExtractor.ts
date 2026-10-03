import path from 'path';
import zlib from 'zlib';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';

const DEFAULT_MAX_SIZE_MB = 10;

export function getMaxSyllabusFileSizeBytes(): number {
  const configuredMb = Number(process.env.SYLLABUS_MAX_FILE_SIZE_MB);
  const mb = !isNaN(configuredMb) && configuredMb > 0
    ? Math.min(configuredMb, DEFAULT_MAX_SIZE_MB)
    : DEFAULT_MAX_SIZE_MB;
  return Math.floor(mb * 1024 * 1024);
}

export interface UploadedSyllabusInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ExtractedSyllabusResult {
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT';
  charCount: number;
  text: string;
}

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

const ALLOWED_MIME_BY_EXT: Record<string, Set<string>> = {
  '.pdf': new Set(['application/pdf', 'application/x-pdf']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'application/zip'
  ]),
  '.txt': new Set(['text/plain', 'application/octet-stream'])
};

function createSyllabusError(message: string, statusCode = 400): Error {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sanitizeExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 30000);
}

/**
 * Fallback native PDF stream text extractor for simple/programmatic valid PDFs
 */
function extractTextFromPdfBufferFallback(buffer: Buffer): string {
  const rawLatin = buffer.toString('latin1');
  const chunks: string[] = [];

  const collectTextTokens = (content: string) => {
    // Match (...) Tj
    const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRegex.exec(content)) !== null) {
      chunks.push(
        m[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
      );
    }

    // Match [...] TJ
    const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((m = tjArrayRegex.exec(content)) !== null) {
      const inner = m[1];
      const strRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let sm: RegExpExecArray | null;
      const lineParts: string[] = [];
      while ((sm = strRegex.exec(inner)) !== null) {
        lineParts.push(
          sm[1]
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\')
        );
      }
      if (lineParts.length > 0) {
        chunks.push(lineParts.join(''));
      }
    }
  };

  collectTextTokens(rawLatin);

  // Also inspect stream ... endstream blocks (including FlateDecode)
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm: RegExpExecArray | null;
  while ((sm = streamRegex.exec(rawLatin)) !== null) {
    const streamBytes = Buffer.from(sm[1], 'latin1');
    try {
      const inflated = zlib.inflateSync(streamBytes).toString('latin1');
      collectTextTokens(inflated);
    } catch {
      // Not a zlib stream or already scanned
    }
  }

  return chunks.join(' ');
}

export async function validateAndExtractSyllabus(
  file: UploadedSyllabusInput | undefined | null
): Promise<ExtractedSyllabusResult> {
  if (!file || !file.buffer) {
    throw createSyllabusError('Please select a syllabus file (PDF, DOCX, or TXT) to upload.', 400);
  }

  const maxBytes = getMaxSyllabusFileSizeBytes();
  const byteLength = file.buffer.length || file.size || 0;

  if (byteLength === 0) {
    throw createSyllabusError('Unable to read this syllabus file.', 400);
  }

  if (byteLength > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw createSyllabusError(
      `Syllabus file exceeds the maximum allowed size of ${maxMb} MB.`,
      400
    );
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw createSyllabusError(
      'Unsupported file type. Only PDF, DOCX, and TXT syllabus files are allowed.',
      400
    );
  }

  const mime = (file.mimetype || '').toLowerCase().split(';')[0].trim();
  const allowedMimes = ALLOWED_MIME_BY_EXT[ext];
  if (!mime || !allowedMimes?.has(mime)) {
    throw createSyllabusError(
      'Unsupported file MIME type. Only valid PDF, DOCX, and TXT files are allowed.',
      400
    );
  }

  // Reject executable headers (MZ / ELF / shebang scripts disguised as txt)
  if (
    (file.buffer.length >= 2 && file.buffer[0] === 0x4d && file.buffer[1] === 0x5a) ||
    (file.buffer.length >= 4 &&
      file.buffer[0] === 0x7f &&
      file.buffer[1] === 0x45 &&
      file.buffer[2] === 0x4c &&
      file.buffer[3] === 0x46)
  ) {
    throw createSyllabusError('Executable files are strictly prohibited.', 400);
  }

  if (ext === '.txt') {
    // Ensure buffer does not contain binary null bytes
    if (file.buffer.includes(0x00)) {
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }
    const rawText = file.buffer.toString('utf8');
    if (!Buffer.from(rawText, 'utf8').equals(file.buffer)) {
      throw createSyllabusError('TXT syllabus must contain valid UTF-8 text.', 400);
    }
    const cleaned = sanitizeExtractedText(rawText);
    if (!cleaned || cleaned.length < 3) {
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }
    return {
      fileName: file.originalname,
      fileType: 'TXT',
      charCount: cleaned.length,
      text: cleaned
    };
  }

  if (ext === '.docx') {
    // DOCX is a ZIP container starting with PK\x03\x04
    if (
      file.buffer.length < 4 ||
      file.buffer[0] !== 0x50 ||
      file.buffer[1] !== 0x4b ||
      file.buffer[2] !== 0x03 ||
      file.buffer[3] !== 0x04
    ) {
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }

    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const cleaned = sanitizeExtractedText(result?.value || '');
      if (!cleaned || cleaned.length < 3) {
        throw createSyllabusError('Unable to read this syllabus file.', 400);
      }
      return {
        fileName: file.originalname,
        fileType: 'DOCX',
        charCount: cleaned.length,
        text: cleaned
      };
    } catch (err: any) {
      if (err.statusCode) throw err;
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }
  }

  if (ext === '.pdf') {
    // Verify PDF header %PDF-
    const header = file.buffer.subarray(0, 5).toString('ascii');
    const fullAscii = file.buffer.toString('latin1');
    if (header !== '%PDF-' || !fullAscii.includes('%%EOF')) {
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }

    let extracted = '';
    try {
      const pdfResult = await extractText(new Uint8Array(file.buffer));
      if (pdfResult && pdfResult.text) {
        extracted = Array.isArray(pdfResult.text)
          ? pdfResult.text.join('\n')
          : String(pdfResult.text);
      }
    } catch {
      // Fallback to native stream text parser below if unpdf fails on minimal PDF
    }

    if (!extracted || sanitizeExtractedText(extracted).length < 3) {
      extracted = extractTextFromPdfBufferFallback(file.buffer);
    }

    const cleaned = sanitizeExtractedText(extracted);
    if (!cleaned || cleaned.length < 3) {
      throw createSyllabusError('Unable to read this syllabus file.', 400);
    }

    return {
      fileName: file.originalname,
      fileType: 'PDF',
      charCount: cleaned.length,
      text: cleaned
    };
  }

  throw createSyllabusError('Unable to read this syllabus file.', 400);
}
