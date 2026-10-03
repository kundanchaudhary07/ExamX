import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { getMaxSyllabusFileSizeBytes, validateAndExtractSyllabus } from '../src/utils/syllabusExtractor';

const syllabusText = 'UNIT I: Computer architecture and digital systems. Processor organization includes arithmetic logic units, control units, registers, memory hierarchy, instruction cycles, addressing modes, and input output systems.';

function file(originalname: string, mimetype: string, content: Buffer) {
  return { originalname, mimetype, size: content.length, buffer: content };
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function run(): Promise<void> {
  const txt = await validateAndExtractSyllabus(file('architecture.txt', 'text/plain', Buffer.from(syllabusText)));
  assert.equal(txt.fileType, 'TXT');
  assert(txt.text.includes('Processor organization'));

  const pdfSource = `%PDF-1.4\n1 0 obj\n<< /Length 240 >>\nstream\nBT /F1 12 Tf 72 720 Td (${syllabusText}) Tj ET\nendstream\nendobj\n%%EOF`;
  const pdf = await validateAndExtractSyllabus(file('architecture.pdf', 'application/pdf', Buffer.from(pdfSource)));
  assert.equal(pdf.fileType, 'PDF');
  assert(pdf.text.includes('Processor organization'));

  const docx = await validateAndExtractSyllabus(
    file('architecture.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await makeDocx(syllabusText))
  );
  assert.equal(docx.fileType, 'DOCX');
  assert(docx.text.includes('Processor organization'));

  await assert.rejects(
    validateAndExtractSyllabus(file('architecture.exe', 'application/octet-stream', Buffer.from(syllabusText))),
    /Unsupported file type/
  );
  await assert.rejects(
    validateAndExtractSyllabus(file('architecture.txt', 'application/pdf', Buffer.from(syllabusText))),
    /MIME type/
  );
  await assert.rejects(
    validateAndExtractSyllabus(file('empty.txt', 'text/plain', Buffer.from('  \n'))),
    /Unable to read/
  );
  await assert.rejects(
    validateAndExtractSyllabus(file('broken.pdf', 'application/pdf', Buffer.from('not a PDF'))),
    /Unable to read/
  );
  await assert.rejects(
    validateAndExtractSyllabus(file('broken.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('not a DOCX'))),
    /Unable to read/
  );
  await assert.rejects(
    validateAndExtractSyllabus(file('oversized.txt', 'text/plain', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))),
    /exceeds the maximum/
  );

  const previousLimit = process.env.SYLLABUS_MAX_FILE_SIZE_MB;
  process.env.SYLLABUS_MAX_FILE_SIZE_MB = '50';
  assert.equal(getMaxSyllabusFileSizeBytes(), 10 * 1024 * 1024);
  if (previousLimit === undefined) delete process.env.SYLLABUS_MAX_FILE_SIZE_MB;
  else process.env.SYLLABUS_MAX_FILE_SIZE_MB = previousLimit;

  console.log('✓ TXT, PDF, and DOCX extraction and upload validation passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
