import { Buffer } from "node:buffer";

export interface DownloadFile {
  data: Buffer;
  name: string;
}

export interface PdfImage {
  bitsPerComponent: number;
  colorSpace: "DeviceGray" | "DeviceRGB";
  data: Buffer;
  decodeParms?: string;
  filter: "DCTDecode" | "FlateDecode";
  height: number;
  width: number;
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
  const decodedHtml = decodeHtmlEntities(html);

  for (const match of decodedHtml.matchAll(/<img\b[^>]*>/gi)) {
    const imageTag = match[0];
    const source = imageTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i)?.slice(1).find(Boolean);

    if (!source)
      continue;

    try {
      const resolved = baseUrl ? new URL(source, baseUrl) : new URL(source);

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

function getJpegImage(data: Buffer): PdfImage | null {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8)
    return null;

  let offset = 2;

  while (offset < data.length) {
    if (data[offset] !== 0xFF) {
      offset += 1;
      continue;
    }

    while (data[offset] === 0xFF)
      offset += 1;

    const marker = data[offset];
    offset += 1;

    if (marker === undefined || marker === 0xDA || marker === 0xD9 || offset + 2 > data.length)
      break;

    const segmentLength = data.readUInt16BE(offset);

    if (segmentLength < 2 || offset + segmentLength > data.length)
      break;

    const isStartOfFrame = marker >= 0xC0
      && marker <= 0xCF
      && ![0xC4, 0xC8, 0xCC].includes(marker);

    if (isStartOfFrame) {
      const bitsPerComponent = data[offset + 2];
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      const components = data[offset + 7];

      if (!bitsPerComponent || !components)
        return null;

      return {
        bitsPerComponent,
        colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
        data,
        filter: "DCTDecode",
        height,
        width,
      };
    }

    offset += segmentLength;
  }

  return null;
}

function getPngImage(data: Buffer): PdfImage | null {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  if (data.length < 33 || !data.subarray(0, pngSignature.length).equals(pngSignature))
    return null;

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitsPerComponent = data[24];
  const colorType = data[25];
  const colorSpace = colorType === 0 ? "DeviceGray" : colorType === 2 ? "DeviceRGB" : null;
  const colors = colorType === 0 ? 1 : colorType === 2 ? 3 : null;

  if (bitsPerComponent !== 8 || !colorSpace || !colors)
    return null;

  const chunks: Buffer[] = [];
  let offset = 8;

  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const start = offset + 8;
    const end = start + length;

    if (end + 4 > data.length)
      return null;

    if (type === "IDAT")
      chunks.push(data.subarray(start, end));

    if (type === "IEND")
      break;

    offset = end + 4;
  }

  if (!chunks.length)
    return null;

  return {
    bitsPerComponent,
    colorSpace,
    data: Buffer.concat(chunks),
    decodeParms: `/Predictor 15 /Colors ${colors} /BitsPerComponent ${bitsPerComponent} /Columns ${width}`,
    filter: "FlateDecode",
    height,
    width,
  };
}

export function getPdfImage(data: Buffer, contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg"))
    return getJpegImage(data);

  if (contentType.includes("png"))
    return getPngImage(data);

  return getJpegImage(data) ?? getPngImage(data);
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

function createStreamObject(stream: Buffer, dictionary = "") {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary}/Length ${stream.length} >>\nstream\n`),
    stream,
    Buffer.from("\nendstream"),
  ]);
}

function getPdfTextPageCommands(page: string[], titleLineCount: number) {
  return page.map((line, lineIndex) => {
    const escapedLine = escapePdfText(line);

    if (lineIndex === 0)
      return `/F1 16 Tf\n54 738 Td\n(${escapedLine}) Tj`;

    if (lineIndex === titleLineCount + 1)
      return `/F1 11 Tf\n0 -24 Td\n(${escapedLine}) Tj`;

    return `0 -14 Td\n(${escapedLine}) Tj`;
  }).join("\n");
}

function getPdfImagePageCommands(image: PdfImage) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (pageWidth - width) / 2;
  const y = (pageHeight - height) / 2;

  return `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im1 Do\nQ`;
}

export function createPdfBuffer(title: string, body: string, images: PdfImage[] = []) {
  const titleLines = wrapText(title, 58).slice(0, 4);
  const contentLines = wrapText(body, 88);
  const allLines = [...titleLines, "", ...contentLines];
  const linesPerPage = 47;
  const pages: string[][] = [];

  for (let index = 0; index < allLines.length; index += linesPerPage)
    pages.push(allLines.slice(index, index + linesPerPage));

  if (pages.length === 0)
    pages.push(["No article content was captured for this entry."]);

  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.alloc(0),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const pageObjectNumbers: number[] = [];
  const addObject = (object: Buffer | string) => {
    objects.push(Buffer.isBuffer(object) ? object : Buffer.from(object));
    return objects.length;
  };

  pages.forEach((page) => {
    const commands = getPdfTextPageCommands(page, titleLines.length);
    const stream = Buffer.from(`BT\n${commands}\nET`);
    const contentObject = addObject(createStreamObject(stream));
    const pageObject = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);

    pageObjectNumbers.push(pageObject);
  });

  images.forEach((image) => {
    const decodeParms = image.decodeParms ? `/DecodeParms << ${image.decodeParms} >> ` : "";
    const imageObject = addObject(createStreamObject(
      image.data,
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} /Filter /${image.filter} ${decodeParms}`,
    ));
    const contentObject = addObject(createStreamObject(Buffer.from(getPdfImagePageCommands(image))));
    const pageObject = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);

    pageObjectNumbers.push(pageObject);
  });

  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageObjectNumbers.map(object => `${object} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`);

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let byteLength = parts[0]!.length;

  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength);

    const wrappedObject = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);

    parts.push(wrappedObject);
    byteLength += wrappedObject.length;
  }

  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets.slice(1))
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;

  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref));

  return Buffer.concat(parts);
}
