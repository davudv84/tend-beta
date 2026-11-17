import { renderStill, selectComposition, openBrowser } from "@remotion/renderer";
const [,, serveUrl, outDir, ...secs] = process.argv;
const browser = await openBrowser("chrome", { browserExecutable: process.env.REMOTION_CHROME });
const composition = await selectComposition({ serveUrl, id: "TendDemo", puppeteerInstance: browser });
for (const s of secs) {
  const frame = Math.round(Number(s) * composition.fps);
  await renderStill({ serveUrl, composition, frame, output: `${outDir}/s_${s}.jpg`, imageFormat: "jpeg", jpegQuality: 85, puppeteerInstance: browser, scale: 0.5 });
  console.log("done", s);
}
await browser.close({ silent: true });
