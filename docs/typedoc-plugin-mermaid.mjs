import { readFileSync } from "node:fs";
import { targetLinkRegistry } from "./mermaid-viewer.mjs";
import * as s from "html-escaper";
import {
	Converter as c,
	MarkdownEvent as h,
	ReflectionKind as k,
	ParameterType as l,
	PageEvent as p,
} from "typedoc";

const viewerSource = readFileSync(new URL("./mermaid-viewer.mjs", import.meta.url), "utf8");
const f = String.raw`
<style>
.mermaid-block[data-viewer-state="ready"] > pre { display: none; }
.mermaid-block > .mermaid { display: none !important; }
.mermaid-stage > .mermaid { margin: 0; }
.mermaid-stage > .mermaid.dark { display: var(--mermaid-dark-display); }
.mermaid-stage > .mermaid.light { display: var(--mermaid-light-display); }
:root { --mermaid-dark-display: none; --mermaid-light-display: block; }
@media (prefers-color-scheme: dark) {
  :root { --mermaid-dark-display: block; --mermaid-light-display: none; }
}
body.light, :root[data-theme="light"] { --mermaid-dark-display: none; --mermaid-light-display: block; }
body.dark, :root[data-theme="dark"] { --mermaid-dark-display: block; --mermaid-light-display: none; }
</style>
`;
function y() {
	return `<script type="module">
${viewerSource}
if (!document.documentElement.hasAttribute("data-mermaid-bootstrap")) {
  document.documentElement.setAttribute("data-mermaid-bootstrap", "");
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs");
    mermaid.registerIconPacks([
      { name: "logos", loader: () => fetch("https://unpkg.com/@iconify-json/logos@1/icons.json").then(res => res.json()) },
      { name: "hugeicons", loader: () => fetch("https://unpkg.com/@iconify-json/hugeicons@1/icons.json").then(res => res.json()) }
    ]);
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
    await initializeMermaidViewers(mermaid);
  } catch (error) {
    console.warn("Unable to load Mermaid; source remains available", error);
  }
}
</script>
`;
}
const m = '<div class="mermaid-block">';
const v = "</div>";
// Only a registry row whose owner is a class declared in that row's own source file is enabled.
function targetLinkMetadata(reflection) {
	const entry =
		typeof reflection.name === "string" &&
		Object.hasOwn(targetLinkRegistry, reflection.name)
			? targetLinkRegistry[reflection.name]
			: undefined;
	if (
		!entry ||
		!reflection.kindOf(k.Class) ||
		!reflection.sources?.some((source) =>
			source.fullFileName
				.replaceAll("\\", "/")
				.endsWith(`/${entry.source}`),
		)
	)
		return undefined;
	return {
		owner: entry.owner,
		node: entry.node,
		targets: entry.targets,
		...(entry.unlinked && { unlinked: entry.unlinked }),
	};
}
class b {
	constructor(e) {
		this.app = e;
	}
	initialize() {
		this.app.options.addDeclaration({
			help: "[Mermaid Plugin] The version of mermaid.js to use.",
			name: "mermaidVersion",
			type: l.String,
			defaultValue: "11.17.2",
		}),
			this.app.converter.on(c.EVENT_RESOLVE_BEGIN, (e) => {
				this.onConverterResolveBegin(e);
			}),
			this.app.renderer.on(p.END, (e) => {
				this.onEndPage(e);
			}),
			this.app.renderer.on(
				h.PARSE,
				(e) => {
					this.onParseMarkdown(e);
				},
				1e3,
			);
	}
	onConverterResolveBegin(e) {
		for (const i of e.project.getReflectionsByKind(k.All)) {
			const { comment: r } = i;
			const targets = targetLinkMetadata(i);
			r &&
				(r.summary
					.filter((a) => a.kind === "code")
					.forEach((a) => {
						a.text = this.handleMermaidCodeBlocks(a.text, targets);
					}),
				r.getTags("@mermaid").forEach((a) => {
					const d = a.content[0];
					d?.text && (d.text = this.handleMermaidTag(d.text, targets));
				}));
		}
	}
	/**
	 * Convert the text of `@mermaid` tags.
	 *
	 * This first line will be the title. It will be wrapped in an h4.
	 * All other lines are mermaid code and will be converted into a mermaid block.
	 */
	handleMermaidTag(e, targets) {
		let a;
		const i = ((a = /^.*/.exec(e)) == null ? void 0 : a[0]) ?? "";
		const r = e.slice(i.length);
		return `#### ${i}

${this.toMermaidBlock(r, targets)}`;
	}
	/**
	 * Replaces mermaid code blocks in Markdown text with mermaid blocks.
	 */
	handleMermaidCodeBlocks(e, targets) {
		return e.replace(/^```mermaid[ \t\r]*\n([\s\S]*?)^```[ \t]*$/gm, (_i, r) =>
			this.toMermaidBlock(r, targets),
		);
	}
	/**
	 * Creates a mermaid block for the given mermaid code.
	 */
	toMermaidBlock(e, targets) {
		const i = s.escape(e.trim());
		const r = `<div class="mermaid dark">%%{init:{"theme":"dark"}}%%
${i}</div>`;
		const a = `<div class="mermaid light">%%{init:{"theme":"default"}}%%
${i}</div>`;
		const d = `<pre><code class="language-mermaid">${i}</code></pre>`;
		const wrapper = targets
			? `<div class="mermaid-block" data-target-links="${s.escape(JSON.stringify(targets))}">`
			: m;
		return wrapper + r + a + d + v;
	}
	onEndPage(e) {
		e.contents !== void 0 &&
			(e.contents = this.insertMermaidScript(e.contents));
	}
	onParseMarkdown(e) {
		e.parsedText = this.handleMermaidCodeBlocks(e.parsedText);
	}
	insertMermaidScript(e) {
		if (!/<div class="mermaid-block"(?:\s[^>]*|)>/.test(e)) return e;
		const i = e.includes("</head>") ? e.indexOf("</head>") : e.length;
		e = e.slice(0, i) + f + e.slice(i);
		const r = e.includes("</body>") ? e.lastIndexOf("</body>") : e.length;
		return (
			e.slice(0, r) +
			y() +
			e.slice(r)
		);
	}
}
function M(t) {
	new b(t).initialize();
}
export { M as load };
