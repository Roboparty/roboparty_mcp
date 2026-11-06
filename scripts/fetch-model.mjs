#!/usr/bin/env node
// Cross-platform Laya ONNX bundle fetcher for @receptron/laya.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const repo = process.env.LAYA_REPO || "receptron/laya-onnx";
const revision = process.env.LAYA_REVISION || "main";
const subfolder = (process.env.LAYA_SUBFOLDER || "").replace(/^\/+|\/+$/g, "");
const mirror = (process.env.LAYA_MIRROR || "https://hf-mirror.com").replace(/\/+$/, "");
const cache = process.env.LAYA_CACHE || path.join(os.homedir(), ".cache", "receptron-laya");
const files = [
  "laya.onnx",
  "laya.onnx.data",
  "laya_config.json",
  "tokenizer/tokenizer.json",
  "tokenizer/tokenizer_config.json",
];
const prefix = subfolder ? `${subfolder}/` : "";
const dest = path.join(cache, repo.replace("/", "--"), revision, subfolder);

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const target = path.join(dest, file);
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`skip existing ${file}`);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const url = `${mirror}/${repo}/resolve/${revision}/${prefix}${file}`;
  console.log(`fetch ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${file}: HTTP ${response.status}`);
  }
  const temporary = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  await import("node:fs/promises").then((fs) => fs.rename(temporary, target));
  console.log(`ready ${target}`);
}
console.log(`Laya bundle ready: ${dest}`);
