import Parser from "rss-parser";

const parser = new Parser();

export async function parseFeed(source: string) {
  return parser.parseString(source);
}
