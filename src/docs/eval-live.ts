import { warmSearchIndex, searchDocs, getPage, listToc } from "./service.js";
import { setupProxy } from "./proxy.js";

async function main() {
  setupProxy();
  console.log("Building/loading corpus (discovers live site)...");
  const corpus = await warmSearchIndex();
  console.log(`revision: ${corpus.revision}`);
  console.log(`docs: ${corpus.docs.length}, index units: ${corpus.units.length}\n`);

  const queries = ["RDK X5 烧录 零点标定", "走线说明", "强化学习训练", "电机 CANFD 调试"];
  for (const q of queries) {
    const r = await searchDocs({ query: q, limit: 3 });
    console.log(`===== search: ${q} (${r.total} hits) =====`);
    for (const h of r.hits) {
      console.log(`  [${h.kind}/${h.lang}] ${h.title}${h.section ? " :: " + h.section : ""} (${h.score})`);
      console.log(`    url: ${h.url}`);
      console.log(`    ${h.snippet.slice(0, 120)}`);
    }
    if (r.warnings.length) console.log(`  warnings: ${r.warnings.join("; ")}`);
    console.log();
  }

  // Fetch one knowledge page section.
  const first = corpus.docs.find((d) => d.lang === "zh");
  if (first) {
    const page = await getPage({ url: first.url });
    console.log("===== get_page sample =====");
    console.log(JSON.stringify(page, null, 2).slice(0, 900));
  }

  const toc = await listToc({ manual: "rp1", lang: "zh" });
  console.log("\n===== github TOC (zh) =====");
  console.log(JSON.stringify(toc, null, 2).slice(0, 700));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
