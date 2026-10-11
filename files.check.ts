// Self-check for files.ts: npx tsx files.check.ts (builds real sample files in memory).
import assert from 'assert';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as Files from './files';
const F: any = Files; // loose typing for the assertions

/** Minimal valid PDF with one text line per page. */
function pdf(pages: string[]) {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((t, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function docx() {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc>${p(t)}</w:tc>`;
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('The termination clause allows 30 days notice.')}<w:tbl><w:tr>${cell('Party')}${cell('Role')}</w:tr><w:tr>${cell('Acme')}${cell('Vendor')}</w:tr></w:tbl></w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

async function pptx() {
  const z = new JSZip();
  z.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Roadmap</a:t></a:r></a:p></p:sld>');
  z.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Launch in Q3</a:t></a:r></a:p></p:sld>');
  return z.generateAsync({ type: 'nodebuffer' });
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  F.configureFiles({ getApiKey: () => '' }); // no Gemini here: media must fail honestly

  assert.equal(F.sanitizeName('..\\..\\Windows/sys<32>.pdf'), 'sys32.pdf');
  assert.equal(F.sanitizeName('../../.env'), 'env');

  const research = await F.addFile('research.pdf', pdf(['Intro to AI systems', 'Results page mentions AI twice: AI']));
  assert.equal(research.status, 'READY', research.error);
  assert.match(research.summary, /^2 pages/);
  let r: any = F.readFile('research.pdf', 'page 2');
  assert.equal(r.part, 'Page 2');
  assert.match(r.content, /Results page/);

  const contract = await F.addFile('contract.docx', await docx());
  assert.equal(contract.status, 'READY', contract.error);
  r = F.readFile('contract');
  assert.match(r.content, /termination clause/);
  assert.match(r.content, /\| Acme \| Vendor \|/, 'tables preserved');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Month', 'Revenue'], ['Jan', 1200], ['Feb', 1850]]), 'Sales');
  const fin = await F.addFile('financial.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(fin.status, 'READY', fin.error);
  r = F.readFile('financial.xlsx', 'Sales');
  assert.match(r.content, /2 data rows x 2 columns/);
  assert.match(r.content, /Feb,1850/);

  const csv = await F.addFile('people.csv', Buffer.from('name,city\nAlex,Lisbon\n"Smith, J",Cape Town\n'));
  assert.match(F.readFile('people.csv').content as string, /"Smith, J",Cape Town/);
  assert.match(csv.summary, /2 rows/);

  const json = await F.addFile('config.json', Buffer.from('{"users":[{"id":1,"name":"a"}],"debug":true}'));
  assert.match(F.readFile('config.json', 'Structure').content as string, /users: array\[1\]/);

  const code = 'def f(x):\n\treturn x  # keep   spacing\n';
  await F.addFile('script.py', Buffer.from(code));
  assert.equal(F.readFile('script.py').content, code, 'code preserved exactly');

  assert.match((await F.addFile('deck.pptx', await pptx())).summary, /2 slides/);
  assert.match(F.readFile('deck', 'slide 2').content as string, /Launch in Q3/);

  const z = new JSZip();
  z.file('src/app.js', 'console.log("hi")');
  z.file('bin/tool.exe', Buffer.from([0, 1, 2]));
  const zip = await F.addFile('bundle.zip', await z.generateAsync({ type: 'nodebuffer' }));
  assert.match(zip.summary, /2 files \(1 readable/);
  assert.match(F.readFile('bundle.zip', 'src/app.js').content as string, /console\.log/);

  const img = await F.addFile('diagram.png', PNG);
  assert.equal(img.status, 'READY');
  assert.equal((await F.executeFileTool('look_at_file', { name: 'diagram.png', question: 'what is it?' }) as any).status, 'FAILED', 'no fake vision answers');

  // Honest failures: unsupported, empty, broken, media without transcription.
  const exe = await F.addFile('setup.exe', Buffer.from([77, 90, 0, 0, 1]));
  assert.equal(exe.status, 'ERROR');
  assert.match(exe.error!, /can't read programs/);
  assert.equal((await F.addFile('blob.bin', Buffer.from([0, 159, 146, 150]))).status, 'ERROR');
  assert.match((await F.addFile('empty.txt', Buffer.alloc(0))).error!, /empty/);
  assert.equal((await F.addFile('broken.xlsx', Buffer.from('not a spreadsheet at all \0\0'))).status, 'ERROR');
  const song = await F.addFile('song.mp3', Buffer.from([0xff, 0xfb, 0x90, 0]));
  assert.equal(song.status, 'ERROR');
  assert.match(song.error!, /GEMINI_API_KEY/);

  // Search across files, with page labels.
  r = F.searchFiles('AI');
  assert.equal(r.matches['research.pdf'], 3);
  assert.ok(r.results.some((h: any) => h.part === 'Page 2'));
  // "it" = the latest ready file; duplicate names get numbered.
  assert.equal((F.readFile() as any).file, 'diagram.png');
  assert.equal((await F.addFile('research.pdf', pdf(['v2']))).name, 'research (2).pdf');

  // Removing a file really removes it from what JARVIS can reach.
  const events: string[] = [];
  F.onFilesChange((e: any) => events.push(`${e.type}:${e.file.name}`));
  assert.ok(F.removeFile(research.id));
  assert.equal((F.readFile('research.pdf') as any).status, 'FAILED');
  assert.equal(F.searchFiles('Intro to AI').matches['research.pdf'], undefined);
  assert.ok(!F.filesNote().includes('- research.pdf '));
  assert.ok(!F.filesForChat().note.includes('Intro to AI'));
  assert.deepEqual(events, ['removed:research.pdf']);
  assert.match(F.filesNote(), /financial\.xlsx/);

  console.log('files: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
