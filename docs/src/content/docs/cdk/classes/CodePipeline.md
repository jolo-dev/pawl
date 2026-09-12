---
editUrl: false
next: false
prev: false
title: "CodePipeline"
---

Defined in: [packages/cdk/src/codepipeline.ts:322](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L322)

An opinionated V2 CodePipeline defined with ordered fluent calls.

Call [source](/pawl/cdk/classes/codepipeline/#source) exactly once before one or more calls to [stage](/pawl/cdk/classes/codepipeline/#stage).
Passing one stage object adds one stage; passing a non-empty list adds its
stage objects sequentially. Actions inside one stage object run in parallel.

Artifact names are inferred when the current frontier has exactly one
artifact. CodeBuild also produces `<SanitizedActionName>Output` by default.
After parallel producers create multiple frontier artifacts, a consuming
action must select one explicitly with `input` (or `inputs`, as applicable),
otherwise Pawl throws `PipelineDefinitionError` with
`ARTIFACT_INPUT_AMBIGUOUS`.

`onPullRequest` and `autoReviewer` are independent:

| onPullRequest | autoReviewer | Behavior |
| --- | --- | --- |
| false/omitted | omitted | Native default-branch trigger |
| true | omitted | Exact-revision PR pipeline router, without AI review |
| false/omitted | present | Native trigger plus standalone AI reviewer |
| true | present | PR router plus durable `AIReview` bridge in the first user stage when coordination is active |

Team and deployment stage are supplied through CDK context (`team` and
`stage`) for `BasicConstruct` naming and tags, not through
[CodePipelineProps](/pawl/cdk/interfaces/codepipelineprops/).

The diagram summarizes provisioned composition and configured actions, not
supplied projects, functions, deployment buckets, or stacks. The V2 pipeline
is created in the constructor; source() binds its CodeCommit source action and
stage() binds user stages/actions. A source and at least one user stage are
required for successful synthesis. Later user stages are not mandatory.

Create source mode provisions a repository, with an initial ZIP asset only when
sourcePath is set. Import and supplied modes create no repository resource.
Pawl creates an artifact bucket only without artifactBucket or
crossRegionReplicationBuckets; it creates the key only when artifactEncryptionKey
is also absent. Supplied storage and CDK-managed cross-region support are omitted.
Undirected edges show configuration, not action execution order.

With onPullRequest and no autoReviewer, PR routing resources include a router,
state table with GSI2, delivery DLQ, repository rules/targets, and an execution
state rule. With autoReviewer, the auto-reviewer composition is created instead
and its router reused; onPullRequest adds an execution-state rule targeting it.
Only active PR-gated auto-review adds an AIReview Lambda action alongside the
first user stage's actions, not a separate stage. Auto-review without PR mode
creates neither that action nor the pipeline execution-state rule. PR mode
disables the native source trigger. The PR-routing summary includes its execution
rule; the separate execution node is only for the alternative reviewer mode.

<div class="mermaid-block" data-target-links="{&quot;owner&quot;:&quot;CodePipeline&quot;,&quot;node&quot;:&quot;actions&quot;,&quot;targets&quot;:[{&quot;name&quot;:&quot;CodeBuildProject&quot;,&quot;href&quot;:&quot;../codebuildproject/&quot;},{&quot;name&quot;:&quot;LambdaFunction&quot;,&quot;href&quot;:&quot;../lambdafunction/&quot;}],&quot;unlinked&quot;:[{&quot;name&quot;:&quot;IBucket&quot;,&quot;note&quot;:&quot;artifact and S3 deploy buckets&quot;},{&quot;name&quot;:&quot;IKey&quot;,&quot;note&quot;:&quot;S3 deploy encryption key&quot;},{&quot;name&quot;:&quot;IRole&quot;,&quot;note&quot;:&quot;action and CloudFormation deployment roles&quot;},{&quot;name&quot;:&quot;ITopic&quot;,&quot;note&quot;:&quot;approval notification topic&quot;},{&quot;name&quot;:&quot;IAction&quot;,&quot;note&quot;:&quot;custom action&quot;},{&quot;name&quot;:&quot;stackName&quot;,&quot;note&quot;:&quot;CloudFormation deployment stack name&quot;}]}"><div class="mermaid dark">%%{init:{"theme":"dark"}}%%
architecture-beta
  group composition(logos:aws-codepipeline)[Configured composition]
  service pipeline(logos:aws-codepipeline)[V2 pipeline] in composition
  service source(logos:aws-codecommit)[CodeCommit source action] in composition
  service actions(logos:aws-codepipeline)[Configured stages and actions] in composition
  service repo(logos:aws-codecommit)[Optional created repository] in composition
  service seed(disk)[Optional initial source ZIP asset] in composition
  service storage(logos:aws-s3)[Optional artifact bucket] in composition
  service key(logos:aws-kms)[Optional created key] in composition
  service pr(logos:aws-lambda)[PR routing without reviewer] in composition
  service reviewer(cloud)[Optional autoReviewer] in composition
  service execution(logos:aws-eventbridge)[Execution rule only in PR mode] in composition
  service aiReview(logos:aws-lambda)[AIReview only active PR mode] in composition
  seed:R --&gt; L:repo
  repo:R -- L:source
  pipeline:T -- R:source
  pipeline:T -- L:actions
  storage:R -- L:pipeline
  storage:L -- R:key
  pr:L -- R:pipeline
  aiReview:L -- R:actions
  aiReview:R -- L:reviewer
  reviewer:R -- L:execution</div><div class="mermaid light">%%{init:{"theme":"default"}}%%
architecture-beta
  group composition(logos:aws-codepipeline)[Configured composition]
  service pipeline(logos:aws-codepipeline)[V2 pipeline] in composition
  service source(logos:aws-codecommit)[CodeCommit source action] in composition
  service actions(logos:aws-codepipeline)[Configured stages and actions] in composition
  service repo(logos:aws-codecommit)[Optional created repository] in composition
  service seed(disk)[Optional initial source ZIP asset] in composition
  service storage(logos:aws-s3)[Optional artifact bucket] in composition
  service key(logos:aws-kms)[Optional created key] in composition
  service pr(logos:aws-lambda)[PR routing without reviewer] in composition
  service reviewer(cloud)[Optional autoReviewer] in composition
  service execution(logos:aws-eventbridge)[Execution rule only in PR mode] in composition
  service aiReview(logos:aws-lambda)[AIReview only active PR mode] in composition
  seed:R --&gt; L:repo
  repo:R -- L:source
  pipeline:T -- R:source
  pipeline:T -- L:actions
  storage:R -- L:pipeline
  storage:L -- R:key
  pr:L -- R:pipeline
  aiReview:L -- R:actions
  aiReview:R -- L:reviewer
  reviewer:R -- L:execution</div><pre><code class="language-mermaid">architecture-beta
  group composition(logos:aws-codepipeline)[Configured composition]
  service pipeline(logos:aws-codepipeline)[V2 pipeline] in composition
  service source(logos:aws-codecommit)[CodeCommit source action] in composition
  service actions(logos:aws-codepipeline)[Configured stages and actions] in composition
  service repo(logos:aws-codecommit)[Optional created repository] in composition
  service seed(disk)[Optional initial source ZIP asset] in composition
  service storage(logos:aws-s3)[Optional artifact bucket] in composition
  service key(logos:aws-kms)[Optional created key] in composition
  service pr(logos:aws-lambda)[PR routing without reviewer] in composition
  service reviewer(cloud)[Optional autoReviewer] in composition
  service execution(logos:aws-eventbridge)[Execution rule only in PR mode] in composition
  service aiReview(logos:aws-lambda)[AIReview only active PR mode] in composition
  seed:R --&gt; L:repo
  repo:R -- L:source
  pipeline:T -- R:source
  pipeline:T -- L:actions
  storage:R -- L:pipeline
  storage:L -- R:key
  pr:L -- R:pipeline
  aiReview:L -- R:actions
  aiReview:R -- L:reviewer
  reviewer:R -- L:execution</code></pre></div>

## Example

**Single and sequential stages, with parallel build actions**

```ts
new CodePipeline(stack, "Pipeline")
	.source({
		origin: "codecommit",
		create: false,
		repositoryName: "orders-service",
	})
	.stage({
		name: "Checks",
		actions: [
			{ type: "codebuild", name: "Unit", project: unitProject },
			{ type: "codebuild", name: "Integration", project: integrationProject },
		],
	})
	.stage([
		{
			name: "Deploy",
			actions: [
				{
					type: "s3Deploy",
					name: "DeployUnit",
					bucket,
					input: "UnitOutput",
				},
			],
		},
		{ name: "Approval", actions: [{ type: "approval", name: "Approve" }] },
	]);
```

## Extends

- `BasicConstruct`

## Constructors

### Constructor

> **new CodePipeline**(`scope`, `id`, `props?`): `CodePipeline`

Defined in: [packages/cdk/src/codepipeline.ts:339](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L339)

#### Parameters

##### scope

[`Stack`](/pawl/cdk/classes/stack/)

##### id

`string`

##### props?

[`CodePipelineProps`](/pawl/cdk/interfaces/codepipelineprops/) = `{}`

#### Returns

`CodePipeline`

#### Overrides

`BasicConstruct.constructor`

## Properties

### artifactBucket

> `readonly` **artifactBucket**: `IBucket`

Defined in: [packages/cdk/src/codepipeline.ts:324](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L324)

***

### artifactEncryptionKey?

> `readonly` `optional` **artifactEncryptionKey?**: `IKey`

Defined in: [packages/cdk/src/codepipeline.ts:325](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L325)

***

### node

> `readonly` **node**: `Node`

Defined in: node\_modules/constructs/lib/construct.d.ts:289

The tree node.

#### Inherited from

`BasicConstruct.node`

***

### pipeline

> `readonly` **pipeline**: `Pipeline`

Defined in: [packages/cdk/src/codepipeline.ts:323](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L323)

***

### prefix

> **prefix**: `string` = `""`

Defined in: [packages/cdk/src/basic-construct.ts:37](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L37)

#### Inherited from

`BasicConstruct.prefix`

***

### stack

> `readonly` **stack**: [`Stack`](/pawl/cdk/classes/stack/)

Defined in: [packages/cdk/src/basic-construct.ts:36](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L36)

#### Inherited from

`BasicConstruct.stack`

## Methods

### createAlarm()

> **createAlarm**(`scope`): `void`

Defined in: [packages/cdk/src/codepipeline.ts:920](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L920)

#### Parameters

##### scope

[`Stack`](/pawl/cdk/classes/stack/)

#### Returns

`void`

#### Overrides

`BasicConstruct.createAlarm`

***

### grantPermission()

> **grantPermission**(`construct`, `policyStatement`): `void`

Defined in: [packages/cdk/src/basic-construct.ts:90](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L90)

Grant specified permissions to another construct

#### Parameters

##### construct

[`Construct`](/pawl/cdk/interfaces/construct/)

The construct to grant permissions to

##### policyStatement

`PolicyStatement`

The permission policy to grant

#### Returns

`void`

#### Inherited from

`BasicConstruct.grantPermission`

***

### grantPermissions()

> **grantPermissions**(`permissions`): `void`

Defined in: [packages/cdk/src/basic-construct.ts:108](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/basic-construct.ts#L108)

Grant multiple permissions to constructs

#### Parameters

##### permissions

`ConstructPermission`[]

Array of [construct, policyStatement] tuples

#### Returns

`void`

#### Inherited from

`BasicConstruct.grantPermissions`

***

### source()

> **source**(`source`): `this`

Defined in: [packages/cdk/src/codepipeline.ts:543](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L543)

Adds the required CodeCommit source before any user stage.

Source ownership is explicit: `create: true` creates a repository (and
may initially seed it with `sync`), `create: false` imports one by name,
and `repository` reuses a supplied `IRepository`. The forms cannot be
combined. `branchName` defaults to `main`, and every form produces the
`SourceOutput` artifact.

#### Parameters

##### source

[`CodeCommitPipelineSource`](/pawl/cdk/type-aliases/codecommitpipelinesource/)

#### Returns

`this`

***

### stage()

#### Call Signature

> **stage**(`stage`): `this`

Defined in: [packages/cdk/src/codepipeline.ts:599](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L599)

Adds one stage object. Its actions run in parallel.

##### Parameters

###### stage

[`PipelineStageDefinition`](/pawl/cdk/interfaces/pipelinestagedefinition/)

##### Returns

`this`

#### Call Signature

> **stage**(`stages`): `this`

Defined in: [packages/cdk/src/codepipeline.ts:601](https://github.com/jolo-dev/pawl/blob/f40688429e7e2c3160e40f482375bd699be30970/packages/cdk/src/codepipeline.ts#L601)

Adds a non-empty list of stages sequentially in array order.

##### Parameters

###### stages

[`PipelineStageDefinitionList`](/pawl/cdk/type-aliases/pipelinestagedefinitionlist/)

##### Returns

`this`

***

### toString()

> **toString**(): `string`

Defined in: node\_modules/constructs/lib/construct.d.ts:314

Returns a string representation of this construct.

#### Returns

`string`

#### Inherited from

`BasicConstruct.toString`

***

### with()

> **with**(...`mixins`): `IConstruct`

Defined in: node\_modules/constructs/lib/construct.d.ts:310

Applies one or more mixins to this construct.

Mixins are applied in order. The list of constructs is captured at the
start of the call, so constructs added by a mixin will not be visited.
Use multiple `with()` calls if subsequent mixins should apply to added
constructs.

#### Parameters

##### mixins

...`IMixin`[]

The mixins to apply

#### Returns

`IConstruct`

This construct for chaining

#### Inherited from

`BasicConstruct.with`

***

### isConstruct()

> `static` **isConstruct**(`x`): `x is Construct`

Defined in: node\_modules/constructs/lib/construct.d.ts:285

Checks if `x` is a construct.

Use this method instead of `instanceof` to properly detect `Construct`
instances, even when the construct library is symlinked.

Explanation: in JavaScript, multiple copies of the `constructs` library on
disk are seen as independent, completely different libraries. As a
consequence, the class `Construct` in each copy of the `constructs` library
is seen as a different class, and an instance of one class will not test as
`instanceof` the other class. `npm install` will not create installations
like this, but users may manually symlink construct libraries together or
use a monorepo tool: in those cases, multiple copies of the `constructs`
library can be accidentally installed, and `instanceof` will behave
unpredictably. It is safest to avoid using `instanceof`, and using
this type-testing method instead.

#### Parameters

##### x

`any`

Any object

#### Returns

`x is Construct`

true if `x` is an object created from a class which extends `Construct`.

#### Inherited from

`BasicConstruct.isConstruct`

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
<script type="module">
// Supported target types, not configured resources. Hrefs stay relative to the generated class page.
// Every row is verified against the owning construct's declared receiver union by docs/tests/mermaid-viewer.test.ts.
export const targetLinkRegistry = {
	ApiGateway: {
		owner: "ApiGateway",
		source: "packages/cdk/src/apigateway.ts",
		pagePath: "/cdk/classes/apigateway/",
		node: "routes",
		caption: "Routes and integrations",
		targets: [
			{ name: "LambdaFunction", href: "../lambdafunction/" },
			{ name: "EventBridge", href: "../eventbridge/" },
		],
	},
	ApiGatewayV1: {
		owner: "ApiGatewayV1",
		source: "packages/cdk/src/apigateway-v1.ts",
		pagePath: "/cdk/classes/apigatewayv1/",
		node: "routes",
		caption: "Routes and integrations",
		targets: [{ name: "LambdaFunction", href: "../lambdafunction/" }],
	},
	EventBridge: {
		owner: "EventBridge",
		source: "packages/cdk/src/eventbridge.ts",
		pagePath: "/cdk/classes/eventbridge/",
		node: "rules",
		caption: "Rules and target bindings",
		targets: [
			{ name: "LambdaFunction", href: "../lambdafunction/" },
			{ name: "ApiDestination", href: "../apidestination/" },
			{ name: "Sqs", href: "../sqs/" },
			{ name: "EventBridge", href: "../eventbridge/" },
		],
		unlinked: [
			{
				name: "EventPipe",
				note: "supplied source and target bus create an independent Pipe, not a rule on this bus",
			},
		],
	},
	Sqs: {
		owner: "Sqs",
		source: "packages/cdk/src/sqs.ts",
		pagePath: "/cdk/classes/sqs/",
		node: "mapping",
		caption: "Event source mapping batch 10",
		targets: [{ name: "LambdaFunction", href: "../lambdafunction/" }],
	},
	CodePipeline: {
		owner: "CodePipeline",
		source: "packages/cdk/src/codepipeline.ts",
		pagePath: "/cdk/classes/codepipeline/",
		node: "actions",
		caption: "Configured stages and actions",
		targets: [
			{ name: "CodeBuildProject", href: "../codebuildproject/" },
			{ name: "LambdaFunction", href: "../lambdafunction/" },
		],
		unlinked: [
			{ name: "IBucket", note: "artifact and S3 deploy buckets" },
			{ name: "IKey", note: "S3 deploy encryption key" },
			{ name: "IRole", note: "action and CloudFormation deployment roles" },
			{ name: "ITopic", note: "approval notification topic" },
			{ name: "IAction", note: "custom action" },
			{ name: "stackName", note: "CloudFormation deployment stack name" },
		],
	},
};

// Selects the generated row that owns this page and rejects anything the row does not allow.
export function parseTargetEntry(serialized, pageUrl) {
	try {
		const value = JSON.parse(serialized);
		const page = new URL(pageUrl);
		const row =
			value &&
			typeof value.owner === "string" &&
			Object.hasOwn(targetLinkRegistry, value.owner)
				? targetLinkRegistry[value.owner]
				: undefined;
		if (
			!row ||
			value.node !== row.node ||
			!Array.isArray(value.targets) ||
			value.targets.length > row.targets.length ||
			!["http:", "https:"].includes(page.protocol) ||
			!page.pathname.endsWith(row.pagePath)
		)
			return undefined;
		const names = new Set();
		const targets = [];
		for (const target of value.targets) {
			if (
				!target ||
				names.has(target.name) ||
				!row.targets.some(
					(allowed) =>
						target.name === allowed.name && target.href === allowed.href,
				)
			)
				return undefined;
			names.add(target.name);
			targets.push({
				name: target.name,
				href: new URL(target.href, page).href,
			});
		}
		const allowedUnlinked = row.unlinked ?? [];
		const notes = new Set();
		const unlinked = [];
		if (value.unlinked !== undefined) {
			if (
				!Array.isArray(value.unlinked) ||
				value.unlinked.length > allowedUnlinked.length
			)
				return undefined;
			for (const note of value.unlinked) {
				if (
					!note ||
					notes.has(note.name) ||
					!allowedUnlinked.some(
						(allowed) =>
							note.name === allowed.name && note.note === allowed.note,
					)
				)
					return undefined;
				notes.add(note.name);
				unlinked.push({ name: note.name, note: note.note });
			}
		}
		return {
			owner: row.owner,
			node: row.node,
			caption: row.caption,
			targets,
			unlinked,
		};
	} catch {
		return undefined;
	}
}

// Mermaid 11.17.2 architecture services use <render id>-service-<authored id>.
// The render prefix is scoped to this SVG; it is never stored as diagram identity.
export function findTargetNode(svg, node) {
	const matches = [...svg.querySelectorAll(".architecture-service")].filter(
		(service) => service.id === `${svg.id}-service-${node}`,
	);
	return matches.length === 1 ? matches[0] : undefined;
}

function enhanceTargetLinks(block, viewer, variants, viewport) {
	const entry = parseTargetEntry(block.dataset.targetLinks, location.href);
	if (!entry?.targets.length) return () => {};
	const nodes = variants.map((variant) =>
		findTargetNode(variant.querySelector("svg"), entry.node),
	);
	if (nodes.some((node) => !node)) return () => {};
	const targets = entry.targets;
	const chooser = document.createElement("div");
	chooser.className = "mermaid-target-chooser";
	chooser.id = `mermaid-targets-${crypto.randomUUID()}`;
	chooser.hidden = true;
	chooser.setAttribute("popover", "manual");
	chooser.setAttribute("role", "group");
	chooser.setAttribute("aria-label", "Supported targets");
	const heading = document.createElement("strong");
	heading.textContent = "Supported targets";
	chooser.append(heading);
	for (const target of targets) {
		const link = document.createElement("a");
		link.href = target.href;
		link.textContent = target.name;
		chooser.append(link);
	}
	if (entry.unlinked.length) {
		const supplied = document.createElement("div");
		supplied.className = "mermaid-target-supplied";
		supplied.setAttribute("role", "group");
		supplied.setAttribute("aria-label", "Supplied values");
		const label = document.createElement("strong");
		label.textContent = "Supplied values";
		supplied.append(label);
		for (const item of entry.unlinked) {
			const note = document.createElement("span");
			note.className = "mermaid-target-note";
			note.textContent = `${item.name}: ${item.note}`;
			supplied.append(note);
		}
		chooser.append(supplied);
	}
	if (targets.length > 1) viewer.append(chooser);
	let trigger;
	function close(restoreFocus = true) {
		if (chooser.hidden) return;
		const focused = chooser.contains(document.activeElement);
		chooser.hidePopover();
		chooser.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
		if (restoreFocus && focused) {
			const visible = !trigger.closest(".mermaid").inert;
			(visible ? trigger : viewport).focus({ preventScroll: true });
		}
	}
	function open(control) {
		if (trigger === control && !chooser.hidden) {
			close();
			return;
		}
		close(false);
		trigger = control;
		control.setAttribute("aria-expanded", "true");
		chooser.hidden = false;
		chooser.showPopover();
		const node = control.getBoundingClientRect();
		const box = chooser.getBoundingClientRect();
		const margin = 8;
		chooser.style.left = `${Math.max(margin, Math.min(innerWidth - box.width - margin, node.left + node.width / 2 - box.width / 2))}px`;
		const below = node.bottom + margin;
		chooser.style.top = `${Math.max(margin, Math.min(innerHeight - box.height - margin, below + box.height <= innerHeight - margin ? below : node.top - box.height - margin))}px`;
		chooser.querySelector("a").focus({ preventScroll: true });
	}
	for (const node of nodes) {
		const control = document.createElementNS(
			"http://www.w3.org/2000/svg",
			targets.length === 1 ? "a" : "g",
		);
		control.classList.add("mermaid-target");
		control.setAttribute("tabindex", "0");
		control.setAttribute(
			"aria-label",
			targets.length === 1
				? `Supported target: ${targets[0].name}`
				: `${entry.caption}: supported targets`,
		);
		if (targets.length === 1) control.setAttribute("href", targets[0].href);
		else {
			control.setAttribute("role", "button");
			control.setAttribute("aria-expanded", "false");
			control.setAttribute("aria-controls", chooser.id);
			control.addEventListener("click", () => open(control));
			control.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				if (!event.repeat) open(control);
			});
		}
		node.before(control);
		control.append(node);
	}
	viewer.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Escape" || chooser.hidden) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		},
		true,
	);
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (
				!chooser.hidden &&
				!chooser.contains(event.target) &&
				!trigger.contains(event.target)
			)
				close(false);
		},
		true,
	);
	document.addEventListener(
		"scroll",
		(event) => {
			if (!chooser.contains(event.target)) close();
		},
		true,
	);
	viewer.addEventListener("focusout", (event) => {
		if (
			!chooser.hidden &&
			!chooser.contains(event.relatedTarget) &&
			!trigger.contains(event.relatedTarget)
		)
			close(false);
	});
	return close;
}

export function nextZoom(zoom, action) {
	if (action === "reset") return 100;
	return Math.min(300, Math.max(50, zoom + (action === "in" ? 25 : -25)));
}

export function fitDiagram(
	width,
	height,
	availableWidth,
	availableHeight,
	zoom,
) {
	const scale = Math.min(1, availableWidth / width, availableHeight / height);
	return {
		width: (width * scale * zoom) / 100,
		height: (height * scale * zoom) / 100,
	};
}

// Centre coordinates are fractions of the drawing, shared across theme variants.
export function resetCamera() {
	return { zoom: 100, x: 0.5, y: 0.5 };
}

export function cameraTransform(camera, drawing, viewport) {
	const scale =
		(Math.min(
			1,
			viewport.width / drawing.width,
			viewport.height / drawing.height,
		) *
			camera.zoom) /
		100;
	return {
		scale,
		x: viewport.width / 2 - camera.x * drawing.width * scale,
		y: viewport.height / 2 - camera.y * drawing.height * scale,
	};
}

export function panCamera(camera, drawing, viewport, dx, dy) {
	const { scale } = cameraTransform(camera, drawing, viewport);
	return {
		...camera,
		x: camera.x - dx / (drawing.width * scale),
		y: camera.y - dy / (drawing.height * scale),
	};
}

export function zoomCamera(
	camera,
	drawing,
	viewport,
	zoom,
	anchor = { x: viewport.width / 2, y: viewport.height / 2 },
) {
	const before = cameraTransform(camera, drawing, viewport);
	const next = { ...camera, zoom: Math.min(300, Math.max(50, zoom)) };
	const after = cameraTransform(next, drawing, viewport);
	return panCamera(
		next,
		drawing,
		viewport,
		anchor.x - (((anchor.x - before.x) / before.scale) * after.scale + after.x),
		anchor.y - (((anchor.y - before.y) / before.scale) * after.scale + after.y),
	);
}

export function wheelZoom(zoom, delta, mode, pageHeight) {
	const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
	return Math.min(300, Math.max(50, zoom * Math.exp(-pixels * 0.002)));
}

function enhanceViewer(block, variants) {
	const viewer = document.createElement("div");
	viewer.className = "mermaid-viewer not-content";
	// Only static application markup; diagram labels never enter this template.
	const expandPath = "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7";
	const restorePath = "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7";
	viewer.innerHTML = `<div class="mermaid-toolbar" role="group" aria-label="Diagram controls">
<button type="button" data-action="reset" aria-label="Reset view" title="Reset view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/></svg></button>
<button type="button" data-action="out" aria-label="Zoom out" title="Zoom out"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/></svg></button>
<button type="button" data-action="in" aria-label="Zoom in" title="Zoom in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/></svg></button>
<button type="button" data-action="expand" aria-label="Expand diagram" title="Expand diagram" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${expandPath}"/></svg></button>
<output aria-live="polite" aria-label="Diagram zoom">100%</output>
</div><div class="mermaid-viewport" tabindex="0" role="region" aria-label="Diagram — wheel to zoom, drag to move. Keyboard: arrows to move, plus or minus to zoom, zero to reset."><div class="mermaid-stage"></div></div>`;
	const viewport = viewer.querySelector(".mermaid-viewport");
	const stage = viewer.querySelector(".mermaid-stage");
	const output = viewer.querySelector("output");
	const expand = viewer.querySelector('[data-action="expand"]');
	const dialog = document.createElement("dialog");
	dialog.className = "mermaid-dialog";
	dialog.setAttribute("aria-label", "Expanded diagram");
	stage.append(...variants);
	block.prepend(viewer);
	let camera = resetCamera();
	let drawing;
	let size;
	let drag;
	const hover = matchMedia("(hover: hover) and (pointer: fine)");
	const closeTargets = enhanceTargetLinks(block, viewer, variants, viewport);
	let suppressActivation = false;

	function paint() {
		closeTargets();
		const { scale, x, y } = cameraTransform(camera, drawing, size);
		stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
		output.textContent = `${Math.round(camera.zoom)}%`;
		viewer.querySelector('[data-action="out"]').disabled = camera.zoom === 50;
		viewer.querySelector('[data-action="in"]').disabled = camera.zoom === 300;
	}
	function layout() {
		// Always-visible touch controls need room instead of masking diagram content.
		const inset = hover.matches
			? 0
			: viewer.querySelector(".mermaid-toolbar").offsetHeight + 16;
		viewer.style.paddingBlockStart = `${inset}px`;
		const dialogStyle = getComputedStyle(dialog);
		const cap = dialog.open
			? Math.max(
					1,
					dialog.clientHeight -
						Number.parseFloat(dialogStyle.paddingTop) -
						Number.parseFloat(dialogStyle.paddingBottom) -
						inset,
				)
			: Math.max(1, Math.min(640, innerHeight * 0.65) - inset);
		for (const variant of variants) {
			const visible = getComputedStyle(variant).display !== "none";
			variant.inert = !visible;
			variant.setAttribute("aria-hidden", String(!visible));
			if (!visible) continue;
			const svg = variant.querySelector("svg");
			const { width, height } = svg.viewBox.baseVal;
			drawing = { width, height };
			const fit = fitDiagram(width, height, viewport.clientWidth, cap, 100);
			size = {
				width: viewport.clientWidth,
				height: dialog.open ? cap : fit.height,
			};
			viewport.style.height = `${size.height}px`;
			stage.style.width = `${width}px`;
			stage.style.height = `${height}px`;
			svg.style.maxWidth = "none";
			svg.style.width = `${width}px`;
			svg.style.height = `${height}px`;
		}
		paint();
	}
	function endDrag() {
		if (!drag) return;
		const { id, moved } = drag;
		if (moved) suppressActivation = true;
		drag = undefined;
		viewer.classList.remove("is-dragging");
		if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
	}
	function setExpandedLabel(open) {
		const label = open ? "Restore diagram" : "Expand diagram";
		expand.setAttribute("aria-label", label);
		expand.title = label;
		expand
			.querySelector("path")
			.setAttribute("d", open ? restorePath : expandPath);
	}
	function restore() {
		closeTargets();
		endDrag();
		block.prepend(viewer);
		block.style.minHeight = "";
		dialog.remove();
		setExpandedLabel(false);
		layout();
		expand.focus({ preventScroll: true });
	}
	function changeZoom(zoom, anchor) {
		camera = zoomCamera(camera, drawing, size, zoom, anchor);
		paint();
	}
	dialog.addEventListener("close", restore);
	viewer.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-action]");
		if (!button) return;
		const action = button.dataset.action;
		if (action === "expand") {
			closeTargets();
			endDrag();
			if (dialog.open) dialog.close();
			else {
				block.style.minHeight = `${block.getBoundingClientRect().height}px`;
				document.body.append(dialog);
				dialog.append(viewer);
				setExpandedLabel(true);
				dialog.showModal();
				layout();
				expand.focus();
			}
			return;
		}
		if (action === "reset") {
			camera = resetCamera();
			paint();
		} else changeZoom(nextZoom(camera.zoom, action));
	});
	viewport.addEventListener(
		"wheel",
		(event) => {
			if (event.ctrlKey || event.metaKey || !event.deltaY) return;
			const zoom = wheelZoom(
				camera.zoom,
				event.deltaY,
				event.deltaMode,
				size.height,
			);
			if (zoom === camera.zoom) return;
			event.preventDefault();
			const rect = viewport.getBoundingClientRect();
			changeZoom(zoom, {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		},
		{ passive: false },
	);
	for (const type of ["click", "auxclick"])
		viewport.addEventListener(
			type,
			(event) => {
				if (!suppressActivation || event.detail === 0) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			},
			true,
		);
	viewport.addEventListener("dragstart", (event) => {
		if (event.target.closest(".mermaid-target")) event.preventDefault();
	});
	viewport.addEventListener("pointerdown", (event) => {
		suppressActivation = false;
		const target = event.target.closest(".mermaid-target");
		if (
			event.pointerType !== "mouse" ||
			!event.isPrimary ||
			event.button !== 0 ||
			(target &&
				(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) ||
			(!target &&
				event.target.closest(
					"a, button, input, textarea, select, [contenteditable]",
				))
		)
			return;
		// Delay capture for linked nodes: capturing on down retargets a real click.
		if (target) {
			drag = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				pending: true,
				moved: false,
			};
			return;
		}
		event.preventDefault();
		viewport.focus({ preventScroll: true });
		drag = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
		};
		viewport.setPointerCapture(event.pointerId);
		viewer.classList.add("is-dragging");
	});
	// Observe pending node drags outside the viewport before capture begins.
	window.addEventListener("pointermove", (event) => {
		if (!drag || drag.id !== event.pointerId) return;
		if (!(event.buttons & 1)) {
			endDrag();
			return;
		}
		if (drag.pending) {
			if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)
				return;
			drag.pending = false;
			viewport.setPointerCapture(event.pointerId);
			viewport.focus({ preventScroll: true });
			viewer.classList.add("is-dragging");
		}
		drag.moved = true;
		camera = panCamera(
			camera,
			drawing,
			size,
			event.clientX - drag.x,
			event.clientY - drag.y,
		);
		drag.x = event.clientX;
		drag.y = event.clientY;
		paint();
	});
	for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
		window.addEventListener(
			type,
			(event) => {
				if (drag?.id !== event.pointerId) return;
				if (type !== "pointerup") suppressActivation = true;
				endDrag();
			},
			true,
		);
	}
	window.addEventListener("blur", () => {
		if (drag) suppressActivation = true;
		endDrag();
	});
	viewport.addEventListener("keydown", (event) => {
		if (
			event.target !== viewport ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		const arrows = {
			ArrowLeft: [40, 0],
			ArrowRight: [-40, 0],
			ArrowUp: [0, 40],
			ArrowDown: [0, -40],
		};
		if (arrows[event.key])
			camera = panCamera(camera, drawing, size, ...arrows[event.key]);
		else if (["+", "=", "-"].includes(event.key))
			camera = zoomCamera(
				camera,
				drawing,
				size,
				nextZoom(camera.zoom, event.key === "-" ? "out" : "in"),
			);
		else if (event.key === "0") camera = resetCamera();
		else return;
		event.preventDefault();
		paint();
	});
	const resize = new ResizeObserver(layout);
	resize.observe(viewport);
	const theme = new MutationObserver(layout);
	theme.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class"],
	});
	theme.observe(document.body, {
		attributes: true,
		attributeFilter: ["class"],
	});
	const preference = matchMedia("(prefers-color-scheme: dark)");
	preference.addEventListener("change", layout);
	hover.addEventListener("change", layout);
	window.addEventListener("resize", layout);
	layout();
}

// Render each logical block independently; a failed theme retains the common source.
export async function initializeMermaidViewers(mermaid, root = document) {
	for (const block of root.querySelectorAll(".mermaid-block")) {
		if (block.dataset.viewerState) continue;
		block.dataset.viewerState = "rendering";
		const variants = [...block.querySelectorAll(":scope > .mermaid")];
		try {
			for (const variant of variants) {
				if (!variant.hasAttribute("data-inserted")) {
					const host = document.createElement("div");
					document.body.append(host);
					try {
						const { svg } = await mermaid.render(
							`pawl-mermaid-${crypto.randomUUID()}`,
							variant.textContent,
							host,
						);
						variant.innerHTML = svg;
					} finally {
						host.remove();
					}
				}
				const svg = variant.querySelector("svg");
				if (
					!svg ||
					variant.querySelector(".error-icon, .error-text") ||
					!(svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0)
				) {
					throw new Error("Mermaid did not produce a valid diagram");
				}
				variant.dataset.inserted = "true";
			}
			if (!variants.length) throw new Error("Missing Mermaid variants");
			await document.fonts.ready;
			enhanceViewer(block, variants);
			block.dataset.viewerState = "ready";
		} catch (error) {
			block.dataset.viewerState = "error";
			const message = document.createElement("p");
			message.className = "mermaid-error";
			message.textContent =
				"Diagram unavailable. Mermaid source is shown below.";
			block.prepend(message);
			console.warn("Unable to render Mermaid diagram", error);
		}
	}
}

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
