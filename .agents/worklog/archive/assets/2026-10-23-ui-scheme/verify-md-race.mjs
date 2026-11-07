import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
import { writeFixtures } from "../../../../vendor/vscode/scripts/gate-fixtures.mjs";
const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url=process.env.URL;
const [A,B]=writeFixtures("md-race",url,[{name:"one.md",body:"# One\n\n## One child\n\nbody\n"},{name:"two.md",body:"# Two\n\n## Two child\n\nbody\n"}]);
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1600,height:1000}}); await p.goto(url,{waitUntil:"load"}); await installDeepDom(p);
await p.waitForFunction(()=>!!globalThis.__vscodeEmbed?.face,null,{timeout:90000});
if(await p.$("[data-prac-firstrun]")){await p.locator("[data-prac-firstrun] button",{hasText:"prac-dev"}).first().click();await p.waitForSelector("[data-prac-firstrun]",{state:"detached"});await p.waitForTimeout(2000);}
for(const f of [A,B]){await p.evaluate(u=>globalThis.__vscodeEmbed.face.openFile(u),f.uri);await waitDeep(p,"[data-vscode-embed-file] .monaco-editor");await p.waitForTimeout(2000);}
const tabs=await p.evaluate(()=>[...document.querySelectorAll("[data-prac-tab]")].filter(e=>e.getAttribute("data-prac-tab")?.includes(".md")).map(e=>e.getAttribute("data-prac-tab")));
const read=()=>p.evaluate(()=>globalThis.__deep.all(".monaco-breadcrumbs").map(el=>({w:Math.round(el.getBoundingClientRect().width),items:[...el.querySelectorAll(".monaco-breadcrumb-item")].map(i=>i.textContent?.trim())})));
console.log("TABS", tabs.length);
for(let i=0;i<10;i++){
  const id=tabs[i%tabs.length];
  await p.click(`[data-prac-tab="${id}"]`);
  await p.waitForTimeout(250);
  const r=await read();
  console.log(i, id.includes("one.md")?"one":"two", JSON.stringify(r));
}
await b.close();
