// fetch-page skill entrypoint: node <file> <inputPath> <outputPath>
import { readFileSync, writeFileSync } from "node:fs";
const [inPath, outPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(inPath, "utf8"));
let out;
try {
  const res = await fetch(String(input.url), { redirect: "follow" });
  const text = await res.text();
  const m = /<title>([^<]*)<\/title>/.exec(text);
  out = { ok: true, status: res.status, title: m ? m[1].trim() : "", length: text.length };
} catch (e) {
  out = { ok: false, status: 0, title: "", length: 0, error: String(e && e.message ? e.message : e) };
}
writeFileSync(outPath, JSON.stringify(out), "utf8");