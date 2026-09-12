import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ReflectionKind } from "typedoc";
import ts from "typescript";
import { load } from "../typedoc-plugin-mermaid.mjs";

const cdkSource = (file: string) =>
	new URL(`../../packages/cdk/src/${file}`, import.meta.url);
const classPage = (name: string) =>
	new URL(`../src/content/docs/cdk/classes/${name}.md`, import.meta.url);
async function readCdkSource(file: string) {
	return ts.createSourceFile(
		file,
		await readFile(cdkSource(file), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
}

function declaredClasses(source: ts.SourceFile) {
	const names = new Set<string>();
	for (const statement of source.statements)
		if (ts.isClassDeclaration(statement) && statement.name)
			names.add(statement.name.text);
	return names;
}

function importedNames(statement: ts.ImportDeclaration) {
	const names: string[] = [];
	const clause = statement.importClause;
	if (!clause) return names;
	if (clause.name) names.push(clause.name.text);
	if (clause.namedBindings) {
		if (ts.isNamespaceImport(clause.namedBindings))
			names.push(clause.namedBindings.name.text);
		else
			for (const element of clause.namedBindings.elements)
				names.push(element.name.text);
	}
	return names;
}

// Pawl classes are classes declared in the file plus classes exported by relative imports.
async function pawlClasses(file: string) {
	const url = cdkSource(file);
	const source = await readCdkSource(file);
	const names = declaredClasses(source);
	for (const statement of source.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		)
			continue;
		const specifier = statement.moduleSpecifier.text;
		if (!specifier.startsWith(".")) continue;
		const target = new URL(`${specifier}.ts`, url);
		if (!existsSync(target)) continue;
		const exported = declaredClasses(
			ts.createSourceFile(
				specifier,
				await readFile(target, "utf8"),
				ts.ScriptTarget.Latest,
				true,
			),
		);
		for (const name of importedNames(statement))
			if (exported.has(name)) names.add(name);
	}
	return names;
}

function declarationFor(source: ts.SourceFile, name: string) {
	return source.statements.find(
		(statement) =>
			(ts.isInterfaceDeclaration(statement) ||
				ts.isTypeAliasDeclaration(statement) ||
				ts.isClassDeclaration(statement)) &&
			statement.name?.text === name,
	);
}

// Follows same-file type and interface declarations such as OrdinaryLambdaFunction or AwsActionBase.
function referencedTypes(source: ts.SourceFile, roots: ts.Node[]) {
	const names = new Set<string>();
	const visited = new Set<ts.Node>();
	const visit = (node: ts.Node) => {
		if (visited.has(node)) return;
		visited.add(node);
		if (ts.isTypeReferenceNode(node)) {
			const name = node.typeName.getText(source);
			names.add(name);
			const declaration = source.statements.find(
				(statement) =>
					(ts.isInterfaceDeclaration(statement) ||
						ts.isTypeAliasDeclaration(statement)) &&
					statement.name.text === name,
			);
			if (declaration) visit(declaration);
		}
		ts.forEachChild(node, visit);
	};
	for (const root of roots) visit(root);
	return names;
}

// Names referenced directly by a type node, without expanding declarations.
function directTypeNames(source: ts.SourceFile, node: ts.TypeNode) {
	const names = new Set<string>();
	const visit = (child: ts.Node) => {
		if (ts.isTypeReferenceNode(child))
			names.add(child.typeName.getText(source));
		ts.forEachChild(child, visit);
	};
	visit(node);
	return names;
}

function propertyType(source: ts.SourceFile, owner: string, member: string) {
	const declaration = declarationFor(source, owner);
	if (!declaration) throw new Error(`Missing declaration ${owner}`);
	const found: ts.TypeNode[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isPropertySignature(node) &&
			node.name?.getText(source) === member &&
			node.type
		)
			found.push(node.type);
		ts.forEachChild(node, visit);
	};
	visit(declaration);
	if (found.length !== 1)
		throw new Error(`Expected one ${owner}.${member}, found ${found.length}`);
	return found[0];
}

function recordValueType(source: ts.SourceFile, owner: string, member: string) {
	const node = propertyType(source, owner, member);
	if (!ts.isTypeReferenceNode(node) || node.typeArguments?.length !== 2)
		throw new Error(`${owner}.${member} is not a two-argument Record`);
	return node.typeArguments[1];
}

function methodParamType(
	source: ts.SourceFile,
	className: string,
	method: string,
	index: number,
) {
	const declaration = declarationFor(source, className);
	if (!declaration || !ts.isClassDeclaration(declaration))
		throw new Error(`Missing class ${className}`);
	const target = declaration.members.find(
		(member) =>
			ts.isMethodDeclaration(member) && member.name.getText(source) === method,
	);
	if (!target || !ts.isMethodDeclaration(target))
		throw new Error(`Missing method ${className}.${method}`);
	const type = target.parameters[index]?.type;
	if (!type)
		throw new Error(`Missing parameter ${index} of ${className}.${method}`);
	return type;
}

function convertDiagram(
	name = "ApiGateway",
	kind = ReflectionKind.Class,
	file = "/repo/packages/cdk/src/apigateway.ts",
) {
	let resolve: (context: unknown) => void = () => {};
	load({
		options: { addDeclaration() {} },
		converter: {
			on(_event: string, callback: typeof resolve) {
				resolve = callback;
			},
		},
		renderer: { on() {} },
	});
	const code = {
		kind: "code",
		text: "```mermaid\narchitecture-beta\n service routes(cloud)[Routes]\n```",
	};
	resolve({
		project: {
			getReflectionsByKind: () => [
				{
					name,
					kindOf: (expected: number) => kind === expected,
					sources: [{ fullFileName: file }],
					comment: { summary: [code], getTags: () => [] },
				},
			],
		},
	});
	return code.text;
}

function blockAttribute(block: string) {
	return block.match(/data-target-links="([^"]+)"/)?.[1] ?? "";
}

function metadata(block: string) {
	const attribute = blockAttribute(block);
	return attribute
		? JSON.parse(attribute.replaceAll("&quot;", '"'))
		: undefined;
}

describe("ApiGateway supported target metadata", () => {
	test("explicit class/source identity survives conversion and attributed-wrapper delivery", () => {
		const block = convertDiagram();
		expect(metadata(block)).toEqual({
			owner: "ApiGateway",
			node: "routes",
			targets: [
				{ name: "LambdaFunction", href: "../lambdafunction/" },
				{ name: "EventBridge", href: "../eventbridge/" },
			],
		});
		expect(emit(block)).toContain("await initializeMermaidViewers(mermaid)");
		for (const block of [
			convertDiagram("EventBridge"),
			convertDiagram("ApiGateway", ReflectionKind.Method),
			convertDiagram(
				"ApiGateway",
				ReflectionKind.Class,
				"/other/apigateway.ts",
			),
		])
			expect(metadata(block)).toBeUndefined();
	});
	test("zero/one/multiple targets and fail-closed destinations for production and no-base routes", async () => {
		const model = await import("../mermaid-viewer.mjs");
		expect(model.parseTargetEntry).toBeFunction();
		const valid = {
			owner: "ApiGateway",
			node: "routes",
			targets: [
				{ name: "LambdaFunction", href: "../lambdafunction/" },
				{ name: "EventBridge", href: "../eventbridge/" },
			],
		};
		for (const base of ["/pawl", ""]) {
			const url = `https://docs.example${base}/cdk/classes/apigateway/`;
			for (const count of [0, 1, 2]) {
				const entry = model.parseTargetEntry(
					JSON.stringify({ ...valid, targets: valid.targets.slice(0, count) }),
					url,
				);
				expect(entry?.targets).toHaveLength(count);
				if (count)
					expect(entry.targets[0].href).toBe(
						`https://docs.example${base}/cdk/classes/lambdafunction/`,
					);
			}
			for (const value of [
				null,
				"{",
				{},
				{ ...valid, owner: "EventBridge" },
				{ ...valid, node: "logs" },
				{ ...valid, targets: [...valid.targets, valid.targets[0]] },
				...[
					"javascript:alert(1)",
					"//evil.example/",
					"https://evil.example/",
					"../lambdafunction/?x=1",
					"../%6cambdafunction/",
					"../eventbridge/",
					"../lambdafunction/#x",
					"../lambdafunction/\\",
				].map((href) => ({
					...valid,
					targets: [{ name: "LambdaFunction", href }],
				})),
			])
				expect(
					model.parseTargetEntry(
						typeof value === "string" ? value : JSON.stringify(value),
						url,
					),
				).toBeUndefined();
		}
	});
	test("supported mapping matches ApiProps.routes and addRoute unions", async () => {
		const source = await readCdkSource("apigateway.ts");
		const names = metadata(convertDiagram())
			?.targets.map((target: { name: string }) => target.name)
			.sort();
		for (const union of [
			recordValueType(source, "ApiProps", "routes"),
			methodParamType(source, "ApiGateway", "addRoute", 1),
		]) {
			if (!ts.isUnionTypeNode(union))
				throw new Error("Missing supported target union");
			expect(names).toEqual(union.types.map((t) => t.getText(source)).sort());
		}
	});
});

describe("supported target link registry", () => {
	const owners = [
		"ApiGateway",
		"ApiGatewayV1",
		"EventBridge",
		"Sqs",
		"CodePipeline",
	];
	test("every row declares generator identity, page route, node, caption and allowlisted targets", async () => {
		const { targetLinkRegistry } = await import("../mermaid-viewer.mjs");
		expect(targetLinkRegistry).toBeObject();
		expect(Object.keys(targetLinkRegistry).sort()).toEqual([...owners].sort());
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			expect(row.owner).toBe(owner);
			expect(row.source).toStartWith("packages/cdk/src/");
			expect(row.source).toEndWith(".ts");
			expect(row.pagePath).toBe(`/cdk/classes/${owner.toLowerCase()}/`);
			expect(row.targets.length).toBeGreaterThan(0);
			expect(new Set(row.targets.map((t) => t.name)).size).toBe(
				row.targets.length,
			);
			for (const target of row.targets)
				expect(target.href).toBe(`../${target.name.toLowerCase()}/`);
			const source = await readFile(
				new URL(`../../${row.source}`, import.meta.url),
				"utf8",
			);
			expect(source).toContain(`service ${row.node}(`);
			expect(source).toContain(`[${row.caption}]`);
		}
	});
	test("round-trips each row on its own page for both URL bases and fails closed elsewhere", async () => {
		const { parseTargetEntry, targetLinkRegistry } = await import(
			"../mermaid-viewer.mjs"
		);
		expect(parseTargetEntry).toBeFunction();
		expect(targetLinkRegistry).toBeObject();
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			const serialized = JSON.stringify({
				owner,
				node: row.node,
				targets: row.targets,
				...(row.unlinked && { unlinked: row.unlinked }),
			});
			for (const base of ["/pawl", ""]) {
				const entry = parseTargetEntry(
					serialized,
					`https://docs.example${base}${row.pagePath}`,
				);
				expect(entry?.node).toBe(row.node);
				expect(entry?.caption).toBe(row.caption);
				expect(entry?.unlinked).toEqual(row.unlinked ?? []);
				expect(entry?.targets.map((t) => t.href)).toEqual(
					row.targets.map(
						(t) =>
							`https://docs.example${base}/cdk/classes/${t.name.toLowerCase()}/`,
					),
				);
				for (const other of owners.filter((name) => name !== owner))
					expect(
						parseTargetEntry(
							serialized,
							`https://docs.example${base}${targetLinkRegistry[other].pagePath}`,
						),
					).toBeUndefined();
			}
		}
	});
	test("cardinality is derived from the row and unsafe, malformed or duplicate values fail closed", async () => {
		const { parseTargetEntry, targetLinkRegistry } = await import(
			"../mermaid-viewer.mjs"
		);
		expect(parseTargetEntry).toBeFunction();
		expect(targetLinkRegistry).toBeObject();
		const eventBridge = targetLinkRegistry.EventBridge;
		const url = "https://docs.example/pawl/cdk/classes/eventbridge/";
		const row = (targets: unknown[], unlinked?: unknown[]) =>
			JSON.stringify({
				owner: "EventBridge",
				node: eventBridge.node,
				targets,
				...(unlinked !== undefined && { unlinked }),
			});
		for (const count of [0, 1, 2, 3, 4])
			expect(
				parseTargetEntry(row(eventBridge.targets.slice(0, count)), url)
					?.targets,
			).toHaveLength(count);
		const pipeline = targetLinkRegistry.CodePipeline;
		for (const value of [
			row([...eventBridge.targets, eventBridge.targets[0]]),
			row(pipeline.targets),
			row([{ name: "LambdaFunction", href: "../sqs/" }]),
			row([{ name: "LambdaFunction" }]),
			row([{ name: "LambdaFunction", href: "https://evil.example/" }]),
			"not json",
			JSON.stringify({ owner: "Unknown", node: "rules", targets: [] }),
			JSON.stringify({
				owner: "EventBridge",
				node: "pipe",
				targets: eventBridge.targets,
			}),
		])
			expect(parseTargetEntry(value, url)).toBeUndefined();
	});
	test("non-linked entries are allowlisted per row and never borrowed from another owner", async () => {
		const { parseTargetEntry, targetLinkRegistry } = await import(
			"../mermaid-viewer.mjs"
		);
		expect(targetLinkRegistry).toBeObject();
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			const url = `https://docs.example/pawl${row.pagePath}`;
			const serialized = (unlinked?: unknown) =>
				JSON.stringify({
					owner,
					node: row.node,
					targets: row.targets,
					...(unlinked !== undefined && { unlinked }),
				});
			expect(parseTargetEntry(serialized(row.unlinked), url)?.unlinked).toEqual(
				row.unlinked ?? [],
			);
			expect(parseTargetEntry(serialized([]), url)?.unlinked).toEqual([]);
			for (const other of owners.filter((name) => name !== owner)) {
				const foreign = targetLinkRegistry[other].unlinked;
				if (foreign)
					expect(parseTargetEntry(serialized(foreign), url)).toBeUndefined();
			}
			for (const invalid of [
				[{ name: "IBucket", note: "invented" }],
				[{ name: row.unlinked?.[0]?.name ?? "EventPipe" }],
				[{ name: "EventPipe", note: "invented" }],
				"EventPipe",
				[...(row.unlinked ?? []), { name: "Extra", note: "invented" }],
			])
				expect(parseTargetEntry(serialized(invalid), url)).toBeUndefined();
		}
	});
	test("every owner emits only its own identity and requires its own source file", async () => {
		const { targetLinkRegistry } = await import("../mermaid-viewer.mjs");
		expect(targetLinkRegistry).toBeObject();
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			const block = convertDiagram(
				owner,
				ReflectionKind.Class,
				`/repo/${row.source}`,
			);
			expect(metadata(block)).toEqual({
				owner,
				node: row.node,
				targets: row.targets,
				...(row.unlinked && { unlinked: row.unlinked }),
			});
			for (const other of [
				convertDiagram(owner, ReflectionKind.Class, "/other/elsewhere.ts"),
				convertDiagram(owner, ReflectionKind.Method, `/repo/${row.source}`),
			])
				expect(metadata(other)).toBeUndefined();
		}
	});
	test("delivered metadata for every owner parses back on its own page", async () => {
		const { parseTargetEntry, targetLinkRegistry } = await import(
			"../mermaid-viewer.mjs"
		);
		expect(parseTargetEntry).toBeFunction();
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			const attribute = blockAttribute(
				convertDiagram(owner, ReflectionKind.Class, `/repo/${row.source}`),
			);
			const entry = parseTargetEntry(
				attribute.replaceAll("&quot;", '"'),
				`https://docs.example/pawl${row.pagePath}`,
			);
			expect(entry?.targets.map((t) => t.name)).toEqual(
				row.targets.map((t) => t.name),
			);
		}
	});
	test("each linked target resolves to a generated class route", async () => {
		const { targetLinkRegistry } = await import("../mermaid-viewer.mjs");
		expect(targetLinkRegistry).toBeObject();
		for (const owner of owners)
			for (const target of targetLinkRegistry[owner].targets)
				expect(existsSync(classPage(target.name))).toBe(true);
	});
	test("registry rows match the declared Pawl receiver unions in the real CDK source", async () => {
		const { targetLinkRegistry } = await import("../mermaid-viewer.mjs");
		expect(targetLinkRegistry).toBeObject();
		const roots = new Map<string, { file: string; roots: ts.Node[] }>();
		{
			const file = "apigateway.ts";
			const source = await readCdkSource(file);
			roots.set("ApiGateway", {
				file,
				roots: [
					recordValueType(source, "ApiProps", "routes"),
					methodParamType(source, "ApiGateway", "addRoute", 1),
				],
			});
		}
		{
			const file = "apigateway-v1.ts";
			const source = await readCdkSource(file);
			roots.set("ApiGatewayV1", {
				file,
				roots: [
					recordValueType(source, "ApiV1Props", "routes"),
					methodParamType(source, "ApiGatewayV1", "addRoute", 1),
				],
			});
		}
		{
			const file = "sqs.ts";
			const source = await readCdkSource(file);
			roots.set("Sqs", {
				file,
				roots: [propertyType(source, "SqsProps", "fn")],
			});
		}
		{
			const file = "eventbridge.ts";
			const source = await readCdkSource(file);
			roots.set("EventBridge", {
				file,
				roots: [propertyType(source, "EventTarget", "type")],
			});
		}
		{
			const file = "pipeline/actions.ts";
			const source = await readCdkSource(file);
			const union = declarationFor(source, "PipelineActionDefinition");
			if (!union) throw new Error("Missing PipelineActionDefinition");
			roots.set("CodePipeline", { file, roots: [union] });
		}
		for (const owner of owners) {
			const row = targetLinkRegistry[owner];
			const { file, roots: typeNodes } = roots.get(owner) ?? {};
			if (owner === "CodePipeline")
				expect(
					await readFile(
						cdkSource(row.source.replace("packages/cdk/src/", "")),
						"utf8",
					),
				).toContain('from "./pipeline/actions"');
			else expect(file).toBe(row.source.replace("packages/cdk/src/", ""));
			if (!typeNodes) throw new Error(`Missing extraction for ${owner}`);
			const source = await readCdkSource(file);
			const pawl = await pawlClasses(file);
			const referenced = referencedTypes(source, typeNodes);
			const declared = [...referenced].filter((name) => pawl.has(name)).sort();
			expect(declared).toEqual(row.targets.map((t) => t.name).sort());
			if (owner === "EventBridge")
				expect(
					[
						...row.targets.map((t) => t.name),
						...row.unlinked.map((u) => u.name),
					].sort(),
				).toEqual(
					[
						...directTypeNames(
							source,
							propertyType(source, "EventTarget", "type"),
						),
					].sort(),
				);
		}
	});
	test("CodePipeline non-linked entries are the union's imported interfaces and plain stack name", async () => {
		const { targetLinkRegistry } = await import("../mermaid-viewer.mjs");
		expect(targetLinkRegistry).toBeObject();
		const file = "pipeline/actions.ts";
		const source = await readCdkSource(file);
		const union = declarationFor(source, "PipelineActionDefinition");
		if (!union) throw new Error("Missing PipelineActionDefinition");
		const referenced = referencedTypes(source, [union]);
		const interfaces = [...referenced]
			.filter((name) => /^I[A-Z]/.test(name))
			.sort();
		const stackName = propertyType(
			source,
			"CloudFormationDeployActionDefinition",
			"stackName",
		);
		expect(stackName.getText(source)).toBe("string");
		const row = targetLinkRegistry.CodePipeline;
		expect(row.unlinked.map((u) => u.name).sort()).toEqual([
			...interfaces,
			"stackName",
		]);
		for (const entry of row.unlinked)
			expect(entry.note.length).toBeGreaterThan(0);
	});
});

function emit(contents: string) {
	const callbacks: ((page: { contents: string }) => void)[] = [];
	load({
		options: { addDeclaration() {}, getValue: () => "latest" },
		converter: { on() {} },
		renderer: {
			on(_event: string, callback: (page: { contents: string }) => void) {
				callbacks.push(callback);
			},
		},
	});
	const page = { contents };
	callbacks[0]?.(page);
	return page.contents;
}

describe("TypeDoc Mermaid viewer delivery", () => {
	test("leaves pages without diagrams untouched", () => {
		expect(emit("Article")).toBe("Article");
	});
	test("pins renderer, preserves strict security, and delivers the actual controller", async () => {
		const emitted = emit('<div class="mermaid-block"><pre>source</pre></div>');
		expect(emitted).toContain("mermaid@11.17.2/");
		expect(emitted).toContain('securityLevel: "strict"');
		expect(emitted).toContain("startOnLoad: false");
		expect(emitted).not.toContain("function check()");
		const controller = await readFile(
			new URL("../mermaid-viewer.mjs", import.meta.url),
			"utf8",
		);
		expect(emitted).toContain(controller.trim());
		expect(emitted).toContain("await initializeMermaidViewers(mermaid)");
	});
});

test("viewer clamps steps, resets to fit, and fits both dimensions without changing geometry", async () => {
	const emitted = emit('<div class="mermaid-block"></div>');
	expect(emitted).toContain("function nextZoom");
	const { nextZoom, fitDiagram } = await import("../mermaid-viewer.mjs");
	expect(nextZoom(100, "in")).toBe(125);
	expect(nextZoom(100, "out")).toBe(75);
	expect(nextZoom(300, "in")).toBe(300);
	expect(nextZoom(50, "out")).toBe(50);
	expect(nextZoom(250, "reset")).toBe(100);
	expect(fitDiagram(1000, 500, 400, 300, 100)).toEqual({
		width: 400,
		height: 200,
	});
	expect(fitDiagram(1000, 500, 400, 100, 300)).toEqual({
		width: 600,
		height: 300,
	});
	expect(fitDiagram(100, 100, 400, 300, 100)).toEqual({
		width: 100,
		height: 100,
	});
});

describe("viewport camera", () => {
	const drawing = { width: 1000, height: 500 };
	const viewport = { width: 400, height: 300 };
	test("centred reset, unrestricted pan at fit, and transform", async () => {
		const model = await import("../mermaid-viewer.mjs");
		expect(model.resetCamera).toBeFunction();
		const camera = model.resetCamera();
		expect(camera).toEqual({ zoom: 100, x: 0.5, y: 0.5 });
		expect(model.cameraTransform(camera, drawing, viewport)).toEqual({
			scale: 0.4,
			x: 0,
			y: 50,
		});
		const panned = model.panCamera(camera, drawing, viewport, 600, -400);
		expect(model.cameraTransform(panned, drawing, viewport)).toEqual({
			scale: 0.4,
			x: 600,
			y: -350,
		});
		expect(model.panCamera(panned, drawing, viewport, -600, 400)).toEqual(
			camera,
		);
		expect(model.resetCamera()).toEqual(camera);
	});
	test("off-centre pointer anchors survive zoom and clamps", async () => {
		const model = await import("../mermaid-viewer.mjs");
		expect(model.zoomCamera).toBeFunction();
		const camera = { zoom: 125, x: -0.2, y: 1.3 };
		const anchor = { x: 87, y: 231 };
		const before = model.cameraTransform(camera, drawing, viewport);
		for (const zoom of [1, 50, 200, 300, 900]) {
			const next = model.zoomCamera(camera, drawing, viewport, zoom, anchor);
			const after = model.cameraTransform(next, drawing, viewport);
			expect(next.zoom).toBe(Math.max(50, Math.min(300, zoom)));
			expect((anchor.x - after.x) / after.scale).toBeCloseTo(
				(anchor.x - before.x) / before.scale,
				8,
			);
			expect((anchor.y - after.y) / after.scale).toBeCloseTo(
				(anchor.y - before.y) / before.scale,
				8,
			);
		}
	});
	test("wheel normalizes pixel, line and page deltas and clamps", async () => {
		const model = await import("../mermaid-viewer.mjs");
		expect(model.wheelZoom).toBeFunction();
		expect(model.wheelZoom(100, 16, 0, 300)).toBeCloseTo(
			model.wheelZoom(100, 1, 1, 300),
		);
		expect(model.wheelZoom(100, 300, 0, 300)).toBeCloseTo(
			model.wheelZoom(100, 1, 2, 300),
		);
		expect(model.wheelZoom(100, -100, 0, 300)).toBeGreaterThan(100);
		expect(model.wheelZoom(100, 100, 0, 300)).toBeLessThan(100);
		expect(model.wheelZoom(100, 1e6, 0, 300)).toBe(50);
		expect(model.wheelZoom(100, -1e6, 0, 300)).toBe(300);
		expect(model.wheelZoom(100, 0, 0, 300)).toBe(100);
	});
});
