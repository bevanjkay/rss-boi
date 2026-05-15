import { Buffer } from "node:buffer";

export interface DownloadFile {
  data: Buffer;
  name: string;
}

export function getSafeDownloadName(value: string) {
  const safeName = value
    .trim()
    .normalize("NFKD")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join("")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return safeName || "rss-boi-post";
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (decimal)
      return String.fromCodePoint(Number.parseInt(decimal, 10));

    if (hex)
      return String.fromCodePoint(Number.parseInt(hex, 16));

    return named ? namedEntities[named.toLowerCase()] ?? match : match;
  });
}

export function getPlainTextFromHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:div|p|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function getImageSourcesFromHtml(html: string, baseUrl: string | null) {
  const sources = new Set<string>();

  for (const match of html.matchAll(/<img[^>]+\ssrc\s*=\s*(["'])(.*?)\1/gi)) {
    const source = match[2];

    if (!source)
      continue;

    try {
      const resolved = baseUrl ? new URL(decodeHtmlEntities(source), baseUrl) : new URL(decodeHtmlEntities(source));

      if (resolved.protocol === "http:" || resolved.protocol === "https:")
        sources.add(resolved.toString());
    }
    catch {
    }
  }

  return Array.from(sources);
}

export function getImageExtension(source: string, contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg"))
    return ".jpg";

  if (contentType.includes("png"))
    return ".png";

  if (contentType.includes("gif"))
    return ".gif";

  if (contentType.includes("webp"))
    return ".webp";

  if (contentType.includes("svg"))
    return ".svg";

  try {
    const extension = new URL(source).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0];
    return extension ?? ".img";
  }
  catch {
    return ".img";
  }
}

let crc32Table: Uint32Array | null = null;

function getCrc32Table() {
  if (crc32Table)
    return crc32Table;

  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;

    table[index] = value >>> 0;
  }

  crc32Table = table;
  return table;
}

function getCrc32(data: Buffer) {
  const table = getCrc32Table();
  let crc = 0xFFFFFFFF;

  for (const byte of data)
    crc = table[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function createZipBuffer(files: DownloadFile[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const crc = getCrc32(file.data);
    const localHeader = Buffer.alloc(30 + nameBytes.length);

    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBytes.length);

    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBytes.copy(centralHeader, 46);

    localParts.push(localHeader, file.data);
    centralParts.push(centralHeader);
    offset += localHeader.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);

  endRecord.writeUInt32LE(0x06054B50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapePdfText(value: string) {
  return normalizePdfText(value).replace(/[\\()]/g, "\\$&");
}

function wrapText(value: string, maxLength: number) {
  const lines: string[] = [];

  for (const paragraph of value.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;

      if (nextLine.length > maxLength && line) {
        lines.push(line);
        line = word;
      }
      else {
        line = nextLine;
      }
    }

    if (line)
      lines.push(line);

    if (words.length > 0)
      lines.push("");
  }

  return lines;
}

export function createPdfBuffer(title: string, body: string) {
  const titleLines = wrapText(title, 58).slice(0, 4);
  const contentLines = wrapText(body, 88);
  const allLines = [...titleLines, "", ...contentLines];
  const linesPerPage = 47;
  const pages: string[][] = [];

  for (let index = 0; index < allLines.length; index += linesPerPage)
    pages.push(allLines.slice(index, index + linesPerPage));

  if (pages.length === 0)
    pages.push(["No article content was captured for this entry."]);

  const pageObjects = pages.map((_, index) => 4 + index * 2);
  const contentObjects = pages.map((_, index) => 5 + index * 2);
  const objects: string[] = [];

  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjects.map(object => `${object} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  objects.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  pages.forEach((page, index) => {
    const pageObject = pageObjects[index]!;
    const contentObject = contentObjects[index]!;
    const commands = page.map((line, lineIndex) => {
      const escapedLine = escapePdfText(line);

      if (lineIndex === 0)
        return `/F1 16 Tf\n54 738 Td\n(${escapedLine}) Tj`;

      if (lineIndex === titleLines.length + 1)
        return `/F1 11 Tf\n0 -24 Td\n(${escapedLine}) Tj`;

      return `0 -14 Td\n(${escapedLine}) Tj`;
    }).join("\n");
    const stream = `BT\n${commands}\nET`;

    objects.push(`${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`);
    objects.push(`${contentObject} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets.slice(1))
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf);
}
