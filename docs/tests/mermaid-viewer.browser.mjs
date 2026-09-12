// Run explicitly with Bun after both docs builds; requires Chromium and CDN access.
// No-base: (cd docs && bun run build --base / --outDir "$PAWL_BROWSER_DIR/no-base-site")
// Then production: (cd docs && bun run build), restoring generated Markdown's /pawl/ base.
// Set PAWL_BROWSER_DIR for both the no-base build and this test (default below).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const dir = process.env.PAWL_BROWSER_DIR ?? "/tmp/pawl-mermaid-viewer-browser";
fs.mkdirSync(dir, { recursive: true });
const server = Bun.serve({
	port: 0,
	fetch(request) {
		if (new URL(request.url).pathname === "/__viewer.mjs")
			return new Response(Bun.file(path.join(root, "docs/mermaid-viewer.mjs")));
		const pathname = new URL(request.url).pathname;
		const site = pathname.startsWith("/pawl/")
			? path.join(root, "public")
			: path.join(dir, "no-base-site");
		let resource = path.join(site, pathname.replace(/^\/pawl\/?/, ""));
		if (fs.existsSync(resource) && fs.statSync(resource).isDirectory())
			resource = path.join(resource, "index.html");
		return fs.existsSync(resource)
			? new Response(Bun.file(resource))
			: new Response("Not found", { status: 404 });
	},
});
const profile = fs.mkdtempSync("/tmp/pawl-contained-chromium-");
const child = Bun.spawn(
	[
		"chromium",
		"--headless",
		"--disable-gpu",
		"--disable-extensions",
		"--remote-debugging-port=0",
		`--user-data-dir=${profile}`,
		"about:blank",
	],
	{
		stdout: Bun.file(path.join(dir, "chromium-stdout.log")),
		stderr: Bun.file(path.join(dir, "chromium-stderr.log")),
	},
);
let socket;
try {
	const active = path.join(profile, "DevToolsActivePort");
	const deadline = Date.now() + 20000;
	while (!fs.existsSync(active)) {
		if (Date.now() > deadline) throw new Error("DevTools startup timeout");
		await Bun.sleep(100);
	}
	const [port, ws] = fs.readFileSync(active, "utf8").trim().split("\n");
	socket = new WebSocket(`ws://127.0.0.1:${port}${ws}`);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const pending = new Map();
	let id = 0;
	const browserErrors = [];
	socket.addEventListener("message", (event) => {
		const data = JSON.parse(event.data);
		if (
			data.method === "Runtime.exceptionThrown" ||
			(data.method === "Runtime.consoleAPICalled" &&
				data.params.type === "error")
		)
			browserErrors.push(data);
		if (!data.id) return;
		const callback = pending.get(data.id);
		if (!callback) return;
		pending.delete(data.id);
		clearTimeout(callback.timer);
		data.error
			? callback.reject(new Error(JSON.stringify(data.error)))
			: callback.resolve(data.result);
	});
	function command(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const current = ++id;
			const timer = setTimeout(() => {
				pending.delete(current);
				reject(new Error(`CDP timeout ${method}`));
			}, 45000);
			pending.set(current, { resolve, reject, timer });
			socket.send(
				JSON.stringify({
					id: current,
					method,
					params,
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	}
	const { targetId } = await command("Target.createTarget", {
		url: "about:blank",
	});
	const { sessionId } = await command("Target.attachToTarget", {
		targetId,
		flatten: true,
	});
	await command("Page.enable", {}, sessionId);
	await command("Runtime.enable", {}, sessionId);
	await command("Page.bringToFront", {}, sessionId);
	async function evaluate(expression) {
		const r = await command(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			sessionId,
		);
		if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
		return r.result.value;
	}

	const results = [];
	async function check(label, expression) {
		const value = await evaluate(expression);
		results.push({ label, passed: value === true, value });
		fs.writeFileSync(
			path.join(dir, "results.json"),
			JSON.stringify(results, null, 2),
		);
		if (value !== true)
			console.log(
				JSON.stringify({
					browserErrors,
					state: await evaluate(
						`({active:document.activeElement?.tagName, output:document.querySelector('output')?.textContent, before:window.before, camera:${state}, dragging:!!document.querySelector('.is-dragging'), events:window.pointerEvents, transform:document.querySelector('.mermaid-stage')?.style.transform})`,
					),
				}),
			);
		assert.equal(value, true, label);
	}
	const settle = () =>
		evaluate(
			`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
		);
	async function click(action) {
		await evaluate(
			`document.querySelector('.mermaid-viewer').scrollIntoView({block:'center'})`,
		);
		const point = await evaluate(
			`(()=>{const r=document.querySelector('[data-action="${action}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", ...point },
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", ...point, button: "left", clickCount: 1 },
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseReleased", ...point, button: "left", clickCount: 1 },
			sessionId,
		);
		await settle();
	}
	const wheel = async (point, deltaY, modifiers = 0) => {
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseWheel", ...point, deltaX: 0, deltaY, modifiers },
			sessionId,
		);
		await Bun.sleep(100);
	};
	const state = `(()=>{const v=document.querySelector('.mermaid-viewport').getBoundingClientRect();const s=[...document.querySelectorAll('.mermaid-stage > .mermaid')].find(e=>!e.inert).querySelector('svg').getBoundingClientRect();const t=document.querySelector('.mermaid-toolbar').getBoundingClientRect();return {x:s.x-v.x,y:s.y-v.y,width:s.width,height:s.height,vw:v.width,vh:v.height,tx:t.x,ty:t.y,zoom:parseFloat(document.querySelector('output').textContent)};})()`;
	const centred = `(()=>{const s=${state};return Math.abs(s.x+s.width/2-s.vw/2)<1&&Math.abs(s.y+s.height/2-s.vh/2)<1;})()`;
	async function drag(point, dx, dy) {
		await evaluate(
			`window.pointerEvents=[];if(!window.traced){window.traced=true;for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture','gotpointercapture','blur'])document.addEventListener(type,e=>{window.pointerEvents.push({type,buttons:e.buttons,button:e.button,pointerType:e.pointerType,isPrimary:e.isPrimary,x:e.clientX,y:e.clientY,target:e.target.tagName,classes:e.target.className?.baseVal??e.target.className});window.pointerEvents=window.pointerEvents.slice(-8)},true)}`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", ...point },
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", ...point, button: "left", clickCount: 1 },
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{
				type: "mouseMoved",
				x: point.x + dx,
				y: point.y + dy,
				button: "left",
				buttons: 1,
			},
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{
				type: "mouseReleased",
				x: point.x + dx,
				y: point.y + dy,
				button: "left",
				clickCount: 1,
			},
			sessionId,
		);
		await settle();
	}

	async function navigate(name, base = "/pawl") {
		await command(
			"Page.navigate",
			{
				url: `http://127.0.0.1:${server.port}${base}/cdk/classes/${name.toLowerCase()}/`,
			},
			sessionId,
		);
		await check(
			`${name}: delivered viewer ready`,
			`new Promise(resolve=>{const end=Date.now()+30000;const timer=setInterval(()=>{if(document.querySelector('[data-viewer-state="ready"]')){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},100);})`,
		);
	}
	async function screenshot(name, expanded = false) {
		await evaluate(
			`if(!document.querySelector('.mermaid-target-chooser:not([hidden])'))document.querySelector('.mermaid-viewer').scrollIntoView({block:'center'})`,
		);
		await settle();
		const clip = expanded
			? undefined
			: await evaluate(
					`(()=>{const r=document.querySelector('.mermaid-viewer').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`,
				);
		const image = await command(
			"Page.captureScreenshot",
			{
				format: "png",
				captureBeyondViewport: !expanded,
				...(clip ? { clip } : {}),
			},
			sessionId,
		);
		fs.writeFileSync(
			path.join(dir, `${name}.png`),
			Buffer.from(image.data, "base64"),
		);
	}
	async function key(key, code = key, shift = false) {
		await command(
			"Input.dispatchKeyEvent",
			{
				type: "keyDown",
				key,
				code,
				text: key === "Enter" ? "\r" : undefined,
				windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[key],
				modifiers: shift ? 8 : 0,
			},
			sessionId,
		);
		await command(
			"Input.dispatchKeyEvent",
			{
				type: "keyUp",
				key,
				code,
				windowsVirtualKeyCode: { Enter: 13, Tab: 9, Escape: 27 }[key],
				modifiers: shift ? 8 : 0,
			},
			sessionId,
		);
	}
	const targetSelector = ".mermaid:not([inert]) .mermaid-target";
	const chooserOpen = `!!document.querySelector('.mermaid-target-chooser:not([hidden])')`;
	async function pointFor(selector) {
		await evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
		);
		await settle();
		return evaluate(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
	}
	async function clickSelector(selector, button = "left", modifiers = 0) {
		const point = await pointFor(selector);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", ...point },
			sessionId,
		);
		for (const type of ["mousePressed", "mouseReleased"])
			await command(
				"Input.dispatchMouseEvent",
				{ type, ...point, button, modifiers, clickCount: 1 },
				sessionId,
			);
		await settle();
	}
	const chooserFits = `(()=>{const c=document.querySelector('.mermaid-target-chooser:not([hidden])');if(!c)return false;const r=c.getBoundingClientRect();return c.matches(':popover-open')&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&[...c.querySelectorAll('a')].every(a=>a.getBoundingClientRect().height>=44);})()`;
	async function newTabClick(selector, button, modifiers, expected) {
		const before = new Set(
			(await command("Target.getTargets")).targetInfos.map((t) => t.targetId),
		);
		const current = await evaluate("location.href");
		await clickSelector(selector, button, modifiers);
		await Bun.sleep(300);
		const opened = (await command("Target.getTargets")).targetInfos.filter(
			(t) => !before.has(t.targetId),
		);
		assert.equal(
			opened.filter((t) => t.url.endsWith(expected)).length,
			1,
			`native ${button}/${modifiers} opens expected target tab`,
		);
		await check(
			`native ${button}/${modifiers} leaves opener unchanged`,
			`location.href===${JSON.stringify(current)}`,
		);
		for (const tab of opened)
			await command("Target.closeTarget", { targetId: tab.targetId });
		await command("Page.bringToFront", {}, sessionId);
	}
	await command(
		"Emulation.setDeviceMetricsOverride",
		{ width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
		sessionId,
	);
	await navigate("ApiGateway");
	await clickSelector(targetSelector);
	await check(
		"real delivered routes click opens Supported targets chooser",
		`${chooserOpen}&&document.querySelector('.mermaid-target-chooser').textContent.includes('Supported targets')`,
	);
	await check(
		"only authored pilot node enhanced, links native and same-tab by default",
		`(()=>{const b=document.querySelector('.mermaid-block');const m=JSON.parse(b.dataset.targetLinks);return m.owner==='ApiGateway'&&m.node==='routes'&&b.querySelectorAll('.mermaid-target').length===2&&b.querySelectorAll('.mermaid-target .architecture-service').length===2&&[...b.querySelectorAll('.mermaid-target .architecture-service')].every(n=>n.id.endsWith('-service-routes'))&&[...b.querySelectorAll('.mermaid-target-chooser a')].map(a=>a.pathname).join(',')==='/pawl/cdk/classes/lambdafunction/,/pawl/cdk/classes/eventbridge/'&&[...b.querySelectorAll('.mermaid-target-chooser a')].every(a=>!a.target&&!a.hasAttribute('onclick'));})()`,
	);
	await check(
		"chooser visible and keyboard starts at first target",
		`${chooserFits}&&document.activeElement.textContent==='LambdaFunction'`,
	);
	await key("Tab");
	await check(
		"Tab reaches second normal anchor",
		`document.activeElement.textContent==='EventBridge'`,
	);
	await key("Tab");
	await check(
		"Tab out dismisses chooser without trapping focus",
		`!(${chooserOpen})&&!document.activeElement.closest('.mermaid-target-chooser')`,
	);
	await clickSelector(targetSelector);
	await key("Escape");
	await check(
		"Escape dismisses chooser and restores node focus",
		`!(${chooserOpen})&&document.activeElement.matches(${JSON.stringify(targetSelector)})`,
	);
	for (const activation of ["Enter", " "]) {
		await key(activation, activation === " " ? "Space" : "Enter");
		await check(
			`node ${activation === " " ? "Space" : "Enter"} opens chooser`,
			chooserOpen,
		);
		await key("Escape");
	}
	await clickSelector(targetSelector);
	await click("in");
	await check("zoom dismisses chooser", `!(${chooserOpen})`);
	await click("reset");
	await clickSelector(targetSelector);
	const nodePoint = await pointFor(targetSelector);
	await wheel(nodePoint, -120);
	await check(
		"real wheel closes chooser and zooms",
		`!(${chooserOpen})&&parseInt(document.querySelector('output').textContent)>100`,
	);
	await click("reset");
	await clickSelector(targetSelector);
	await evaluate(`window.before=${state}`);
	await drag(await pointFor(targetSelector), -50, 30);
	await check(
		"real linked-node drag pans without chooser/navigation and releases capture",
		`!(${chooserOpen})&&location.pathname.endsWith('/apigateway/')&&!document.querySelector('.is-dragging')&&Math.abs((${state}).x-before.x+50)<1&&Math.abs((${state}).y-before.y-30)<1`,
	);
	await click("reset");
	await clickSelector(targetSelector);
	await check("real node click recovers after drag", chooserOpen);
	await key("Escape");
	const outsideStart = await pointFor(targetSelector);
	await evaluate(`window.before=${state}`);
	await drag(outsideStart, 20 - outsideStart.x, 0);
	await check(
		"linked-node drag crossing viewport in first move still pans and cannot activate",
		`Math.abs((${state}).x-before.x-(${20 - outsideStart.x}))<1&&!(${chooserOpen})&&!document.querySelector('.is-dragging')&&location.pathname.endsWith('/apigateway/')`,
	);
	await click("reset");
	// Below the drag threshold, preserve click (capture must not retarget it).
	await drag(await pointFor(targetSelector), 2, 1);
	await check("small node movement remains a click", chooserOpen);
	await key("Escape");
	for (const cancel of ["pointercancel", "lostpointercapture"]) {
		const p = await pointFor(targetSelector);
		await evaluate(
			`window.linkPointerId=undefined;document.querySelector('.mermaid-viewport').addEventListener('pointerdown',e=>window.linkPointerId=e.pointerId,{once:true})`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", ...p, button: "left", clickCount: 1 },
			sessionId,
		);
		await command(
			"Input.dispatchMouseEvent",
			{
				type: "mouseMoved",
				x: p.x + 12,
				y: p.y + 8,
				buttons: 1,
				button: "left",
			},
			sessionId,
		);
		await evaluate(
			`document.querySelector('.mermaid-viewport').dispatchEvent(new PointerEvent('${cancel}',{pointerId:window.linkPointerId}))`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseReleased", ...p, button: "left", clickCount: 1 },
			sessionId,
		);
		await check(
			`linked node ${cancel} suppresses release activation`,
			`!(${chooserOpen})&&!document.querySelector('.is-dragging')&&location.pathname.endsWith('/apigateway/')`,
		);
		await click("reset");
		await clickSelector(targetSelector);
		await check(`linked node recovers after ${cancel}`, chooserOpen);
		await key("Escape");
	}
	await clickSelector(targetSelector);
	await evaluate(`document.documentElement.dataset.theme='light'`);
	await settle();
	await check(
		"theme closes chooser and avoids hidden-variant focus",
		`!(${chooserOpen})&&!document.activeElement.closest('[inert]')`,
	);
	await clickSelector(targetSelector);
	await command(
		"Emulation.setDeviceMetricsOverride",
		{ width: 1400, height: 980, deviceScaleFactor: 1, mobile: false },
		sessionId,
	);
	await settle();
	await check("resize closes chooser", `!(${chooserOpen})`);
	await clickSelector(targetSelector);
	await click("expand");
	await check(
		"expand closes old chooser",
		`!(${chooserOpen})&&document.querySelector('.mermaid-dialog').open`,
	);
	await clickSelector(targetSelector);
	await check("chooser is visible in native dialog top layer", chooserFits);
	await key("Escape");
	await check(
		"first Escape closes chooser before viewer",
		`!(${chooserOpen})&&document.querySelector('.mermaid-dialog').open&&document.activeElement.matches(${JSON.stringify(targetSelector)})`,
	);
	await key("Escape");
	await settle();
	await check(
		"second Escape restores viewer and toolbar focus",
		`!document.querySelector('.mermaid-dialog')&&document.activeElement.dataset.action==='expand'`,
	);
	await click("expand");
	await clickSelector(targetSelector);
	await click("expand");
	await check(
		"explicit Restore with chooser open leaves no overlay and restores focus",
		`!document.querySelector('.mermaid-dialog')&&!(${chooserOpen})&&document.activeElement.dataset.action==='expand'`,
	);
	await clickSelector(targetSelector);
	await clickSelector('.mermaid-toolbar [data-action="reset"]');
	await check(
		"outside click dismisses without stealing toolbar focus",
		`!(${chooserOpen})&&document.activeElement.dataset.action==='reset'`,
	);
	await clickSelector(targetSelector);
	await evaluate("window.scrollBy(0,40)");
	await settle();
	await check(
		"page scroll dismisses fixed chooser without stranding focus",
		`!(${chooserOpen})&&document.activeElement.matches(${JSON.stringify(targetSelector)})`,
	);
	// Native browser navigation, not a synthetic click or an href-only assertion.
	const newTabModifier = await evaluate(
		`navigator.platform.includes('Mac') ? 4 : 2`,
	);
	for (const name of ["lambdafunction", "eventbridge"]) {
		await clickSelector(targetSelector);
		const selector = `.mermaid-target-chooser a[href$="/${name}/"]`;
		await newTabClick(
			selector,
			"left",
			newTabModifier,
			`/pawl/cdk/classes/${name}/`,
		);
		if (!(await evaluate(chooserOpen))) await clickSelector(targetSelector);
		await newTabClick(selector, "middle", 0, `/pawl/cdk/classes/${name}/`);
		if (!(await evaluate(chooserOpen))) await clickSelector(targetSelector);
		await clickSelector(selector);
		await check(
			`${name}: normal click navigates same tab to delivered documentation`,
			`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/pawl/cdk/classes/${name}/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
		);
		await navigate("ApiGateway");
	}
	for (const name of ["lambdafunction", "eventbridge"]) {
		await navigate("ApiGateway", "");
		await clickSelector(targetSelector);
		await check(
			"actual no-base build resolves supported target routes",
			`[...document.querySelectorAll('.mermaid-target-chooser a')].map(a=>a.pathname).join(',')==='/cdk/classes/lambdafunction/,/cdk/classes/eventbridge/'`,
		);
		await clickSelector(`.mermaid-target-chooser a[href$="/${name}/"]`);
		await check(
			`no-base native navigation reaches real ${name} documentation`,
			`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/cdk/classes/${name}/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
		);
	}
	await navigate("ApiGateway");
	await evaluate(
		`document.querySelector('.mermaid-viewer').scrollIntoView({block:'center'})`,
	);
	await settle();
	const wheelPoint = await evaluate(
		`(()=>{const r=document.querySelector('.mermaid-viewport').getBoundingClientRect();return {x:r.x+r.width*.3,y:r.y+r.height*.6};})()`,
	);
	await command(
		"Input.dispatchMouseEvent",
		{ type: "mouseWheel", ...wheelPoint, deltaX: 0, deltaY: -120 },
		sessionId,
	);
	await Bun.sleep(100);
	await check(
		"real wheel zooms delivered drawing",
		`parseFloat(document.querySelector('output').textContent)>100`,
	);
	await click("reset");
	for (const name of [
		"ApiGateway",
		"AgentCore",
		"AuthoritativeRevisionArbitrationExhaustedError",
	]) {
		await navigate(name);
		if (name !== "ApiGateway")
			await check(
				`${name}: no pilot metadata or interactive nodes`,
				`!document.querySelector('[data-target-links], .mermaid-target, .mermaid-target-chooser')`,
			);
		for (const [size, width] of [
			["desktop", 1440],
			["mobile", 390],
		])
			for (const theme of ["dark", "light"]) {
				await command(
					"Emulation.setTouchEmulationEnabled",
					{ enabled: size === "mobile" },
					sessionId,
				);
				await command(
					"Emulation.setDeviceMetricsOverride",
					{
						width,
						height: 1000,
						deviceScaleFactor: 1,
						mobile: size === "mobile",
					},
					sessionId,
				);
				await evaluate(`document.documentElement.dataset.theme='${theme}'`);
				await click("in");
				await command(
					"Emulation.setDeviceMetricsOverride",
					{
						width: width - 20,
						height: 980,
						deviceScaleFactor: 1,
						mobile: size === "mobile",
					},
					sessionId,
				);
				await evaluate(
					`document.documentElement.dataset.theme='${theme === "dark" ? "light" : "dark"}'`,
				);
				await settle();
				await check(
					"theme and resize preserve one shared zoom",
					`document.querySelector('output').textContent==='125%'&&document.querySelectorAll('.mermaid-toolbar').length===1`,
				);
				await command(
					"Emulation.setDeviceMetricsOverride",
					{
						width,
						height: 1000,
						deviceScaleFactor: 1,
						mobile: size === "mobile",
					},
					sessionId,
				);
				await evaluate(`document.documentElement.dataset.theme='${theme}'`);
				await click("reset");
				await settle();
				await check(
					`${name} ${size} ${theme}: one toolbar, hidden theme inert, fit, touch targets`,
					`(()=>{
    const v=document.querySelector('.mermaid-viewport'); const variants=[...v.querySelectorAll('.mermaid')];
    const visible=variants.filter(e=>getComputedStyle(e).display!=='none');
    return document.querySelectorAll('.mermaid-toolbar').length===1&&visible.length===1&&variants.filter(e=>e.inert&&e.getAttribute('aria-hidden')==='true').length===1&&(${centred})&&(${state}).width<=v.clientWidth+1&&(${state}).height<=v.clientHeight+1&&[...document.querySelectorAll('.mermaid-toolbar button')].every(e=>e.offsetWidth>=44&&e.offsetHeight>=44)&&document.querySelector('output').textContent==='100%';
   })()`,
				);
				await evaluate(
					`document.activeElement.blur();document.querySelector('.mermaid-viewer').scrollIntoView({block:'center'});`,
				);
				await command(
					"Input.dispatchMouseEvent",
					{ type: "mouseMoved", x: 1, y: 1 },
					sessionId,
				);
				await settle();
				await check(
					"toolbar overlays desktop diagrams and leaves touch content clear",
					`(()=>{const t=document.querySelector('.mermaid-toolbar');const v=document.querySelector('.mermaid-viewport').getBoundingClientRect();const r=t.getBoundingClientRect();return getComputedStyle(t).position==='absolute'&&r.right<=v.right&&${size === "desktop" ? "r.top>=v.top&&r.bottom<=v.bottom&&Math.abs(document.querySelector('.mermaid-viewer').getBoundingClientRect().height-v.height)<1" : "r.bottom<=v.top"};})()`,
				);
				await check(
					`${size}: pointer-appropriate toolbar visibility`,
					`(()=>{const s=getComputedStyle(document.querySelector('.mermaid-toolbar'));return ${size === "desktop" ? "matchMedia('(hover: hover) and (pointer: fine)').matches&&s.opacity==='0'&&s.pointerEvents==='none'" : "!matchMedia('(hover: hover) and (pointer: fine)').matches&&s.opacity==='1'&&s.pointerEvents!=='none'"};})()`,
				);
				if (name === "ApiGateway")
					await screenshot(`${name}-${size}-${theme}-rest`);
				const point = await evaluate(
					`(()=>{const r=document.querySelector('.mermaid-viewport').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
				);
				await command(
					"Input.dispatchMouseEvent",
					{ type: "mouseMoved", ...point },
					sessionId,
				);
				await settle();
				await check(
					"hover reveals floating controls",
					`getComputedStyle(document.querySelector('.mermaid-toolbar')).opacity==='1'`,
				);
				if (name === "ApiGateway")
					await screenshot(`${name}-${size}-${theme}-hover`);
				await command(
					"Input.dispatchMouseEvent",
					{ type: "mouseMoved", x: 1, y: 1 },
					sessionId,
				);
				await evaluate(`document.querySelector('.mermaid-viewport').focus()`);
				await settle();
				await check(
					"keyboard focus reveals controls without hover",
					`getComputedStyle(document.querySelector('.mermaid-toolbar')).opacity==='1'&&getComputedStyle(document.querySelector('.mermaid-toolbar')).pointerEvents!=='none'`,
				);
				await evaluate(
					`window.diagramGeometry=[...document.querySelectorAll('.mermaid > svg')].map(s=>s.getAttribute('viewBox')+s.innerHTML);window.pageWidth=document.documentElement.scrollWidth`,
				);
				if (name === "ApiGateway" || (size === "desktop" && theme === "dark"))
					await screenshot(`${name}-${size}-${theme}-inline`);
				if (name === "ApiGateway") {
					if (size === "mobile") {
						const p = await pointFor(targetSelector);
						await command(
							"Input.dispatchTouchEvent",
							{ type: "touchStart", touchPoints: [p] },
							sessionId,
						);
						await command(
							"Input.dispatchTouchEvent",
							{ type: "touchEnd", touchPoints: [] },
							sessionId,
						);
						// Let the browser's transient native tap highlight finish before capture.
						await Bun.sleep(350);
					} else {
						await evaluate(
							`document.querySelector(${JSON.stringify(targetSelector)}).focus()`,
						);
						await key("Enter");
					}
					await check(
						`${size} ${theme}: real touch/keyboard chooser within viewport`,
						chooserFits,
					);
					await screenshot(`target-${size}-${theme}-inline-keyboard`, true);
					await key("Escape");
					if (size === "mobile") {
						const p = await pointFor(targetSelector);
						await evaluate("window.targetScroll=scrollY");
						await command(
							"Input.dispatchTouchEvent",
							{ type: "touchStart", touchPoints: [p] },
							sessionId,
						);
						await command(
							"Input.dispatchTouchEvent",
							{ type: "touchMove", touchPoints: [{ x: p.x, y: p.y - 150 }] },
							sessionId,
						);
						await command(
							"Input.dispatchTouchEvent",
							{ type: "touchEnd", touchPoints: [] },
							sessionId,
						);
						await Bun.sleep(150);
						await check(
							`${theme}: linked-node touch swipe remains native, not an activation`,
							`scrollY>targetScroll&&!(${chooserOpen})&&!document.querySelector('.is-dragging')&&document.querySelector('output').textContent==='100%'`,
						);
					}
				}
				if (size === "desktop") {
					await click("reset");
					const point = await evaluate(
						`(()=>{const r=document.querySelector('.mermaid-viewport').getBoundingClientRect();return {x:r.x+r.width*.3,y:r.y+r.height*.65};})()`,
					);
					await evaluate(`window.before=${state}`);
					await drag(point, -85, 55);
					await check(
						"real drag pans freely at fit, toolbar stationary, capture released",
						`(()=>{const s=${state};return Math.abs(s.x-before.x+85)<1&&Math.abs(s.y-before.y-55)<1&&s.tx===before.tx&&s.ty===before.ty&&!document.querySelector('.is-dragging');})()`,
					);
					await evaluate(
						`window.before=${state};window.anchor={x:before.vw*.3,y:before.vh*.65}`,
					);
					await wheel(point, -120);
					await check(
						"off-centre real wheel preserves drawing point under pointer",
						`(()=>{const s=${state};return s.zoom>100&&Math.abs((anchor.x-before.x)/before.width-(anchor.x-s.x)/s.width)<.001&&Math.abs((anchor.y-before.y)/before.height-(anchor.y-s.y)/s.height)<.001;})()`,
					);
					await evaluate(`window.before=${state}`);
					await drag(point, 100, -45);
					await check(
						"real drag after zoom",
						`(()=>{const s=${state};return Math.abs(s.x-before.x-100)<1&&Math.abs(s.y-before.y+45)<1;})()`,
					);
					if (name === "ApiGateway")
						await screenshot(`${name}-${size}-${theme}-mouse-panned`);
					await evaluate(
						`window.before=${state};document.documentElement.dataset.theme='${theme === "dark" ? "light" : "dark"}'`,
					);
					await command(
						"Emulation.setDeviceMetricsOverride",
						{
							width: width - 20,
							height: 980,
							deviceScaleFactor: 1,
							mobile: false,
						},
						sessionId,
					);
					await settle();
					const sameCentre = `(()=>{const s=${state};return s.zoom===before.zoom&&Math.abs((s.vw/2-s.x)/s.width-(before.vw/2-before.x)/before.width)<.002&&Math.abs((s.vh/2-s.y)/s.height-(before.vh/2-before.y)/before.height)<.002;})()`;
					await check(
						"theme and resize retain inspected world centre",
						sameCentre,
					);
					await click("expand");
					await check("expand retains inspected world centre", sameCentre);
					await click("expand");
					await check("restore retains inspected world centre", sameCentre);
					await command(
						"Emulation.setDeviceMetricsOverride",
						{ width, height: 1000, deviceScaleFactor: 1, mobile: false },
						sessionId,
					);
					await evaluate(`document.documentElement.dataset.theme='${theme}'`);
					await settle();
					await evaluate(
						`document.querySelector('.mermaid-viewer').scrollIntoView({block:'center'})`,
					);
					await settle();
					await wheel(point, 120);
					await check(
						"real wheel zoom out",
						`document.querySelector('output').textContent==='100%'`,
					);
					await click("reset");
					await evaluate(
						`document.querySelector('.mermaid-viewport').focus();window.before=${state}`,
					);
					await key("ArrowRight");
					await check(
						"scoped keyboard pan",
						`Math.abs((${state}).x-before.x+40)<1`,
					);
					await key("+", "Equal");
					await check(
						"scoped keyboard plus",
						`document.querySelector('output').textContent==='125%'`,
					);
					await key("-", "Minus");
					await check(
						"scoped keyboard minus",
						`document.querySelector('output').textContent==='100%'`,
					);
					await key("0", "Digit0");
					await check("scoped keyboard reset centres", centred);
				}
				await evaluate(`document.querySelector('[data-action="in"]').focus()`);
				await key("Enter");
				await check(
					"keyboard zoom",
					`document.querySelector('output').textContent==='125%'`,
				);
				for (let i = 0; i < 10; i++) await click("in");
				await settle();
				await check(
					"300% bound and clipped camera without article growth",
					`(()=>{
    const v=document.querySelector('.mermaid-viewport');
    return document.querySelector('[data-action="in"]').disabled&&document.querySelector('output').textContent==='300%'&&getComputedStyle(v).overflow==='clip'&&document.documentElement.scrollWidth===window.pageWidth;
   })()`,
				);
				if (name === "ApiGateway")
					await screenshot(`${name}-${size}-${theme}-zoomed`);
				await evaluate(
					`window.inlineBlockHeight=document.querySelector('.mermaid-block').getBoundingClientRect().height`,
				);
				await click("expand");
				await settle();
				await check(
					"native modal retains zoom and focuses Restore",
					`document.querySelector('.mermaid-dialog').matches(':modal')&&document.activeElement.getAttribute('aria-label')==='Restore diagram'&&document.querySelector('output').textContent==='300%'`,
				);
				await check(
					"article position retained while expanded",
					`Math.abs(document.querySelector('.mermaid-block').getBoundingClientRect().height-window.inlineBlockHeight)<1`,
				);
				if (name === "ApiGateway")
					await screenshot(`${name}-${size}-${theme}-expanded-zoomed`, true);
				await key("Tab");
				await check(
					"native modal contains keyboard focus",
					`document.querySelector('.mermaid-dialog').contains(document.activeElement)`,
				);
				await click("reset");
				await settle();
				await check(
					"expanded Reset fits without clipped bottom edge",
					`(()=>{const v=document.querySelector('.mermaid-viewport');const d=document.querySelector('.mermaid-dialog');return (${centred})&&(${state}).height<=v.clientHeight+1&&(${state}).width<=v.clientWidth+1&&v.getBoundingClientRect().bottom<=d.getBoundingClientRect().bottom-10;})()`,
				);
				if (name === "ApiGateway") {
					await screenshot(`${name}-${size}-${theme}-expanded`, true);
					await clickSelector(targetSelector);
					await check(
						`${size} ${theme}: expanded chooser within viewport`,
						chooserFits,
					);
					await screenshot(`target-${size}-${theme}-expanded`, true);
					await key("Escape");
					await check(
						"expanded chooser Escape preserves viewer",
						`!!document.querySelector('.mermaid-dialog[open]')&&!(${chooserOpen})`,
					);
				}
				await key("Escape");
				await settle();
				await check(
					"Escape restores DOM and focus",
					`!document.querySelector('.mermaid-dialog')&&document.querySelector('.mermaid-block > .mermaid-viewer')!==null&&document.activeElement.dataset.action==='expand'`,
				);
				await click("expand");
				await click("expand");
				await settle();
				await check(
					"explicit Restore returns focus",
					`!document.querySelector('.mermaid-dialog')&&document.activeElement.dataset.action==='expand'`,
				);
				for (let i = 0; i < 5; i++) await click("out");
				await check(
					"50% lower bound",
					`document.querySelector('[data-action="out"]').disabled&&document.querySelector('output').textContent==='50%'`,
				);
				await click("reset");
				await check(
					"Reset centre; SVG contents and connector geometry untouched",
					`(()=>{const v=document.querySelector('.mermaid-viewport');return (${centred})&&JSON.stringify(window.diagramGeometry)===JSON.stringify([...document.querySelectorAll('.mermaid > svg')].map(s=>s.getAttribute('viewBox')+s.innerHTML));})()`,
				);
			}
	}
	// Rollout rows: real delivered pages for each additional registry owner.
	const rolloutRows = [
		{
			name: "ApiGatewayV1",
			node: "routes",
			caption: "Routes and integrations",
			linked: ["lambdafunction"],
			supplied: [],
		},
		{
			name: "Sqs",
			node: "mapping",
			caption: "Event source mapping batch 10",
			linked: ["lambdafunction"],
			supplied: [],
		},
		{
			name: "EventBridge",
			node: "rules",
			caption: "Rules and target bindings",
			linked: ["lambdafunction", "apidestination", "sqs", "eventbridge"],
			supplied: ["EventPipe"],
		},
		{
			name: "CodePipeline",
			node: "actions",
			caption: "Configured stages and actions",
			linked: ["codebuildproject", "lambdafunction"],
			supplied: ["IBucket", "IKey", "IRole", "ITopic", "IAction", "stackName"],
		},
	];
	for (const row of rolloutRows) {
		await navigate(row.name);
		await check(
			`${row.name}: delivered page carries only its own allowlisted metadata`,
			`(()=>{const b=document.querySelector('.mermaid-block');if(!b?.dataset.targetLinks)return false;const m=JSON.parse(b.dataset.targetLinks);return m.owner===${JSON.stringify(row.name)}&&m.node===${JSON.stringify(row.node)}&&m.targets.map(t=>t.name.toLowerCase()).join()===${JSON.stringify(row.linked.join(","))}&&(m.unlinked??[]).map(u=>u.name).join()===${JSON.stringify(row.supplied.join(","))}&&(m.unlinked??[]).every(u=>typeof u.note==='string'&&u.note.length>0);})()`,
		);
		await check(
			`${row.name}: only the authored ${row.node} node is enhanced`,
			`(()=>{const b=document.querySelector('.mermaid-block');const nodes=[...b.querySelectorAll('.mermaid-target .architecture-service')];return b.querySelectorAll('.mermaid-target').length===2&&nodes.length===2&&nodes.every(n=>n.id.endsWith('-service-${row.node}'))&&b.querySelectorAll('.mermaid-target-chooser').length===${row.linked.length === 1 ? 0 : 1};})()`,
		);
		if (row.linked.length === 1) {
			await check(
				`${row.name}: single supported target is a genuine SVG anchor without a chooser`,
				`(()=>{const m=JSON.parse(document.querySelector('.mermaid-block').dataset.targetLinks);const a=document.querySelector(${JSON.stringify(targetSelector)});return !!a&&a.tagName==='a'&&a.getAttribute('href').endsWith('/pawl/cdk/classes/${row.linked[0]}/')&&a.getAttribute('aria-label')==='Supported target: '+m.targets[0].name&&!a.hasAttribute('role')&&!document.querySelector('.mermaid-target-chooser');})()`,
			);
			await clickSelector(targetSelector);
			await check(
				`${row.name}: direct anchor click navigates same tab to delivered documentation`,
				`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/pawl/cdk/classes/${row.linked[0]}/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
			);
			await navigate(row.name);
			await evaluate(
				`window.directTransform=document.querySelector('.mermaid-stage').style.transform`,
			);
			await drag(await pointFor(targetSelector), -40, 20);
			await check(
				`${row.name}: direct-anchor drag pans without navigating`,
				`location.pathname.endsWith('/${row.name.toLowerCase()}/')&&document.querySelector('.mermaid-stage').style.transform!==window.directTransform&&!document.querySelector('.is-dragging')`,
			);
			await click("reset");
			await newTabClick(
				targetSelector,
				"left",
				newTabModifier,
				`/pawl/cdk/classes/${row.linked[0]}/`,
			);
			await newTabClick(
				targetSelector,
				"middle",
				0,
				`/pawl/cdk/classes/${row.linked[0]}/`,
			);
		} else {
			await clickSelector(targetSelector);
			await check(
				`${row.name}: chooser lists only its own linked Pawl targets`,
				`(()=>{const c=document.querySelector('.mermaid-target-chooser:not([hidden])');if(!c)return false;return [...c.querySelectorAll('a')].map(a=>a.pathname).join()===${JSON.stringify(row.linked.map((n) => `/pawl/cdk/classes/${n}/`).join(","))}&&c.getAttribute('aria-label')==='Supported targets'&&document.querySelector(${JSON.stringify(targetSelector)}).getAttribute('aria-label')===${JSON.stringify(`${row.caption}: supported targets`)};})()`,
			);
			await check(
				`${row.name}: supplied values are labelled text, not links or focus targets`,
				`(()=>{const c=document.querySelector('.mermaid-target-chooser');const notes=[...c.querySelectorAll('.mermaid-target-note')];const section=c.querySelector('.mermaid-target-supplied');return notes.map(n=>n.textContent.split(':')[0]).join()===${JSON.stringify(row.supplied.join(","))}&&notes.every(n=>n.tagName==='SPAN'&&n.tabIndex===-1&&!n.querySelector('a')&&n.closest('a')===null)&&section.getAttribute('role')==='group'&&section.getAttribute('aria-label')==='Supplied values'&&section.querySelector('strong').textContent==='Supplied values'&&c.querySelector('strong').textContent==='Supported targets'&&c.textContent.includes('Supported targets')&&c.textContent.includes('Supplied values');})()`,
			);
			await evaluate(
				`document.querySelector('.mermaid-target-chooser a').focus()`,
			);
			for (let i = 0; i < row.linked.length; i++) await key("Tab");
			await check(
				`${row.name}: Tab skips supplied values and dismisses the chooser`,
				`!document.activeElement.closest('.mermaid-target-note')&&!(${chooserOpen})`,
			);
			await clickSelector(targetSelector);
			await clickSelector(
				`.mermaid-target-chooser a[href$="/${row.linked[0]}/"]`,
			);
			await check(
				`${row.name}: chooser anchor click navigates same tab to delivered documentation`,
				`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/pawl/cdk/classes/${row.linked[0]}/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
			);
			await navigate(row.name);
			await clickSelector(targetSelector);
			await newTabClick(
				`.mermaid-target-chooser a[href$="/${row.linked[0]}/"]`,
				"left",
				newTabModifier,
				`/pawl/cdk/classes/${row.linked[0]}/`,
			);
			if (!(await evaluate(chooserOpen))) await clickSelector(targetSelector);
			await newTabClick(
				`.mermaid-target-chooser a[href$="/${row.linked[0]}/"]`,
				"middle",
				0,
				`/pawl/cdk/classes/${row.linked[0]}/`,
			);
		}
	}
	// One batched delivery pass per new row across desktop/mobile and dark/light.
	for (const [row, size, width, theme] of [
		[rolloutRows[0], "desktop", 1440, "dark"],
		[rolloutRows[1], "mobile", 390, "light"],
		[rolloutRows[2], "desktop", 1440, "dark"],
		[rolloutRows[2], "mobile", 390, "light"],
		[rolloutRows[3], "desktop", 1440, "dark"],
		[rolloutRows[3], "desktop", 1440, "light"],
	]) {
		await command(
			"Emulation.setTouchEmulationEnabled",
			{ enabled: size === "mobile" },
			sessionId,
		);
		await command(
			"Emulation.setDeviceMetricsOverride",
			{ width, height: 1000, deviceScaleFactor: 1, mobile: size === "mobile" },
			sessionId,
		);
		await navigate(row.name);
		await evaluate(`document.documentElement.dataset.theme='${theme}'`);
		await evaluate(
			`window.diagramGeometry=[...document.querySelectorAll('.mermaid > svg')].map(s=>s.getAttribute('viewBox')+s.innerHTML)`,
		);
		if (row.linked.length === 1) {
			await check(
				`${row.name} ${size} ${theme}: delivered direct anchor is visible and fitted`,
				`(()=>{const a=document.querySelector(${JSON.stringify(targetSelector)});return !!a&&a.tagName==='a'&&a.getBoundingClientRect().width>0&&document.querySelector('output').textContent==='100%';})()`,
			);
			await evaluate(
				`document.querySelector(${JSON.stringify(targetSelector)}).focus()`,
			);
		} else {
			await clickSelector(targetSelector);
			await check(
				`${row.name} ${size} ${theme}: real chooser fits with its supplied values`,
				chooserFits,
			);
		}
		await screenshot(`target-${row.name}-${size}-${theme}`, true);
		await key("Escape");
		await settle();
		await check(
			`${row.name} ${size} ${theme}: enhancement leaves Mermaid geometry and connectors byte-identical`,
			`document.querySelector('output').textContent==='100%'&&JSON.stringify(window.diagramGeometry)===JSON.stringify([...document.querySelectorAll('.mermaid > svg')].map(s=>s.getAttribute('viewBox')+s.innerHTML))`,
		);
		await click("reset");
	}
	await command(
		"Emulation.setTouchEmulationEnabled",
		{ enabled: false },
		sessionId,
	);
	await command(
		"Emulation.setDeviceMetricsOverride",
		{ width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
		sessionId,
	);
	await navigate("ApiGateway");
	await click("reset");
	await check(
		"compact icons retain accessible names, titles and hidden zoom status",
		`(()=>{const buttons=[...document.querySelectorAll('.mermaid-toolbar button')];const out=document.querySelector('.mermaid-toolbar output');return buttons.length===4&&buttons.every(b=>b.textContent===''&&b.querySelector('svg[aria-hidden="true"]')&&b.title===b.getAttribute('aria-label'))&&out.getAttribute('aria-live')==='polite'&&out.getBoundingClientRect().width===1;})()`,
	);
	const point = await evaluate(
		`(()=>{const r=document.querySelector('.mermaid-viewport').getBoundingClientRect();return {x:r.x+r.width*.3,y:r.y+r.height*.6};})()`,
	);
	await drag(point, -point.x + 2, 10);
	await check(
		"release outside viewport clears capture and drag",
		`!document.querySelector('.is-dragging')`,
	);
	await evaluate(`window.before=${state}`);
	await command(
		"Input.dispatchMouseEvent",
		{ type: "mouseMoved", ...point },
		sessionId,
	);
	await check("released mouse no longer pans", `(${state}).x===before.x`);
	for (const cancel of ["pointercancel", "lostpointercapture"]) {
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", ...point, button: "left", clickCount: 1 },
			sessionId,
		);
		await evaluate(
			`(()=>{const v=document.querySelector('.mermaid-viewport');v.addEventListener('pointermove',e=>{window.pointerId=e.pointerId},{once:true});})()`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{
				type: "mouseMoved",
				x: point.x + 5,
				y: point.y + 5,
				button: "left",
				buttons: 1,
			},
			sessionId,
		);
		await check(
			"mouse captured during drag",
			`document.querySelector('.mermaid-viewport').hasPointerCapture(window.pointerId)`,
		);
		await evaluate(
			`document.querySelector('.mermaid-viewport').dispatchEvent(new PointerEvent('${cancel}',{pointerId:window.pointerId}))`,
		);
		await check(
			`${cancel}: cleanup releases capture`,
			`!document.querySelector('.is-dragging')&&!document.querySelector('.mermaid-viewport').hasPointerCapture(window.pointerId)`,
		);
		await command(
			"Input.dispatchMouseEvent",
			{ type: "mouseReleased", ...point, button: "left", clickCount: 1 },
			sessionId,
		);
		await evaluate(`window.before=${state}`);
		await drag(point, 25, -10);
		await check(
			`${cancel}: subsequent drag works`,
			`Math.abs((${state}).x-before.x-25)<1`,
		);
	}
	await click("reset");
	await check(
		"touch, pen, non-primary and interactive targets are not captured",
		`(()=>{const v=document.querySelector('.mermaid-viewport');const link=document.createElement('a');link.href='#';v.append(link);const targets=[[v,'touch',0,true],[v,'pen',0,true],[v,'mouse',2,true],[v,'mouse',0,false],[link,'mouse',0,true]];const ok=targets.every(([target,pointerType,button,isPrimary])=>{const e=new PointerEvent('pointerdown',{pointerType,button,isPrimary,pointerId:99,bubbles:true,cancelable:true});return target.dispatchEvent(e)&&!document.querySelector('.is-dragging');});link.remove();return ok&&getComputedStyle(v).touchAction==='auto';})()`,
	);
	await check(
		"Ctrl/Meta wheel and descendant keyboard remain native",
		`(()=>{const v=document.querySelector('.mermaid-viewport');const input=document.createElement('input');v.append(input);const ok=['ctrlKey','metaKey'].every(mod=>v.dispatchEvent(new WheelEvent('wheel',{deltaY:50,[mod]:true,cancelable:true})))&&input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));input.remove();return ok;})()`,
	);
	for (const modifiers of [2, 4]) {
		await wheel(point, -120, modifiers);
		await check(
			"real browser modified wheel leaves logical zoom alone",
			`document.querySelector('output').textContent==='100%'`,
		);
	}
	await click("reset");
	const toolbarPoint = await evaluate(
		`(()=>{const r=document.querySelector('.mermaid-toolbar').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	await wheel(toolbarPoint, 100);
	await check(
		"real toolbar wheel leaves camera unchanged",
		`document.querySelector('output').textContent==='100%'`,
	);
	await evaluate(`window.scrollTo(0,0);window.beforeScroll=scrollY`);
	await wheel({ x: 700, y: 200 }, 200);
	await check(
		"real outside wheel scrolls article without zoom",
		`scrollY>beforeScroll&&document.querySelector('output').textContent==='100%'`,
	);
	await click("reset");
	await wheel(point, -1e5);
	await check(
		"wheel reaches maximum",
		`document.querySelector('[data-action="in"]').disabled`,
	);
	await check(
		"wheel at maximum is not prevented",
		`document.querySelector('.mermaid-viewport').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,cancelable:true}))`,
	);
	await wheel(point, 1e5);
	await check(
		"wheel reaches minimum",
		`document.querySelector('[data-action="out"]').disabled`,
	);
	await check(
		"wheel at minimum is not prevented",
		`document.querySelector('.mermaid-viewport').dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true}))`,
	);
	await click("reset");
	await command(
		"Emulation.setTouchEmulationEnabled",
		{ enabled: true },
		sessionId,
	);
	await evaluate(`window.beforeScroll=scrollY`);
	await command(
		"Input.dispatchTouchEvent",
		{ type: "touchStart", touchPoints: [{ ...point }] },
		sessionId,
	);
	await command(
		"Input.dispatchTouchEvent",
		{ type: "touchMove", touchPoints: [{ x: point.x, y: point.y - 150 }] },
		sessionId,
	);
	await command(
		"Input.dispatchTouchEvent",
		{ type: "touchEnd", touchPoints: [] },
		sessionId,
	);
	await Bun.sleep(150);
	await check(
		"real touch swipe scrolls page without camera capture",
		`scrollY>beforeScroll&&!document.querySelector('.is-dragging')&&document.querySelector('output').textContent==='100%'`,
	);
	// Synthetic cardinalities exercise the public direct-import path without enabling another construct.
	await command(
		"Emulation.setTouchEmulationEnabled",
		{ enabled: false },
		sessionId,
	);
	await navigate("ApiGateway");
	await evaluate(`window.makeTargetFixture=async (metadata,missing=false)=>{
		document.querySelector('#target-fixture')?.remove();
		const original=document.querySelector('.mermaid-block');
		const fixture=document.createElement('section');fixture.id='target-fixture';
		const block=document.createElement('div');block.className='mermaid-block';
		if(metadata!==null)block.dataset.targetLinks=typeof metadata==='string'?metadata:JSON.stringify(metadata);
		for(const source of original.querySelectorAll('.mermaid-stage > .mermaid')){
			const variant=source.cloneNode(true);
			for(const control of variant.querySelectorAll('.mermaid-target'))control.replaceWith(...control.childNodes);
			if(missing&&variant.classList.contains('light'))variant.querySelector('[id$="-service-routes"]').remove();
			block.append(variant);
		}
		const pre=document.createElement('pre');pre.textContent='Synthetic pre-rendered fixture';block.append(pre);
		fixture.append(block);document.querySelector('main').append(fixture);
		const {initializeMermaidViewers}=await import('/__viewer.mjs');
		await initializeMermaidViewers({render:()=>{throw new Error('pre-rendered fixtures must not rerender')}},fixture);
	};window.pilotMetadata=JSON.parse(document.querySelector('.mermaid-block').dataset.targetLinks);`);
	for (const [label, value, missing] of [
		["absent", "null", false],
		["zero", "{...pilotMetadata,targets:[]}", false],
		["malformed", "'{'", false],
		[
			"unsafe",
			"{...pilotMetadata,targets:[{name:'LambdaFunction',href:'javascript:alert(1)'}]}",
			false,
		],
		["wrong owner", "{...pilotMetadata,owner:'EventBridge'}", false],
		["missing authored node in one theme", "pilotMetadata", true],
	]) {
		await evaluate(`makeTargetFixture(${value},${missing})`);
		await check(
			`synthetic ${label}: fail closed to noninteractive viewer`,
			`document.querySelector('#target-fixture [data-viewer-state="ready"]')!==null&&!document.querySelector('#target-fixture .mermaid-target, #target-fixture .mermaid-target-chooser')`,
		);
	}
	await evaluate(
		`makeTargetFixture({...pilotMetadata,targets:pilotMetadata.targets.slice(0,1)})`,
	);
	const direct = "#target-fixture .mermaid:not([inert]) .mermaid-target";
	await check(
		"single target is a genuine SVG anchor, no chooser",
		`(()=>{const a=document.querySelector(${JSON.stringify(direct)});return a.tagName==='a'&&a.getAttribute('href').endsWith('/pawl/cdk/classes/lambdafunction/')&&!a.hasAttribute('role')&&!document.querySelector('#target-fixture .mermaid-target-chooser');})()`,
	);
	await evaluate(
		`window.directTransform=document.querySelector('#target-fixture .mermaid-stage').style.transform`,
	);
	await drag(await pointFor(direct), -40, 20);
	await check(
		"single-anchor real drag pans without navigating",
		`location.pathname.endsWith('/apigateway/')&&document.querySelector('#target-fixture .mermaid-stage').style.transform!==window.directTransform&&!document.querySelector('.is-dragging')`,
	);
	await newTabClick(
		direct,
		"left",
		newTabModifier,
		"/pawl/cdk/classes/lambdafunction/",
	);
	await newTabClick(direct, "middle", 0, "/pawl/cdk/classes/lambdafunction/");
	const fixtureFactory = await evaluate("makeTargetFixture.toString()");
	await clickSelector(direct);
	await check(
		"single-anchor ordinary click navigates same tab",
		`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/pawl/cdk/classes/lambdafunction/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
	);
	await navigate("ApiGateway");
	await evaluate(
		`window.makeTargetFixture=${fixtureFactory};window.pilotMetadata=JSON.parse(document.querySelector('.mermaid-block').dataset.targetLinks);makeTargetFixture({...pilotMetadata,targets:pilotMetadata.targets.slice(0,1)})`,
	);
	await evaluate(`document.querySelector(${JSON.stringify(direct)}).focus()`);
	await key("Enter");
	await check(
		"single-anchor native Enter navigates same tab",
		`new Promise(resolve=>{const end=Date.now()+10000;const t=setInterval(()=>{if(location.pathname==='/pawl/cdk/classes/lambdafunction/'&&document.querySelector('h1')){clearInterval(t);resolve(true);}else if(Date.now()>end){clearInterval(t);resolve(false);}},50);})`,
	);
	await navigate("ApiGateway");
	// Real renderer, malformed neighbor, injected rejection/error SVG, repeated and concurrent setup.
	await check(
		"isolated failures, successful neighbors, no duplicate setup",
		`(async()=>{
  const {initializeMermaidViewers}=await import('/__viewer.mjs');
  const {default:mermaid}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs');
  const root=document.createElement('section');document.querySelector('main').append(root);
  const block=source=>{const b=document.createElement('div');b.className='mermaid-block';for(const theme of ['dark','light']){const v=document.createElement('div');v.className='mermaid '+theme;v.textContent=source;b.append(v);}const pre=document.createElement('pre');pre.textContent=source;b.append(pre);root.append(b);return b;};
  const bad=block('not a Mermaid diagram');const good=block('flowchart LR\\n A[One] --> B[Two]');
  await Promise.all([initializeMermaidViewers(mermaid,root),initializeMermaidViewers(mermaid,root)]);
  await initializeMermaidViewers(mermaid,document);
  const rejected=block('rejected');await initializeMermaidViewers({render:async()=>{throw new Error('injected renderer rejection');}},root);
  const errorSvg=block('error SVG');await initializeMermaidViewers({render:async()=>({svg:'<svg viewBox="0 0 100 100"><text class="error-text">error</text></svg>'})},root);
  return [bad,rejected,errorSvg].every(b=>b.dataset.viewerState==='error'&&getComputedStyle(b.querySelector('pre')).display!=='none'&&!b.querySelector('.mermaid-toolbar'))&&good.dataset.viewerState==='ready'&&good.querySelectorAll('.mermaid-toolbar').length===1&&document.querySelectorAll('.mermaid-toolbar').length===2;
 })()`,
	);
	await command("Network.enable", {}, sessionId);
	await command(
		"Network.setBlockedURLs",
		{ urls: ["*cdn.jsdelivr.net/npm/mermaid*"] },
		sessionId,
	);
	await command("Page.reload", { ignoreCache: true }, sessionId);
	await Bun.sleep(2000);
	await check(
		"CDN blocked: source remains readable, no controls",
		`!!document.querySelector('.mermaid-block > pre')&&getComputedStyle(document.querySelector('.mermaid-block > pre')).display!=='none'&&!document.querySelector('.mermaid-toolbar')`,
	);
	await command("Network.setBlockedURLs", { urls: [] }, sessionId);
	await command(
		"Emulation.setScriptExecutionDisabled",
		{ value: true },
		sessionId,
	);
	await command("Page.reload", { ignoreCache: true }, sessionId);
	await Bun.sleep(2000);
	await check(
		"no JavaScript: readable source",
		`!!document.querySelector('.mermaid-block > pre')&&getComputedStyle(document.querySelector('.mermaid-block > pre')).display!=='none'`,
	);
	fs.writeFileSync(
		path.join(dir, "console-errors.json"),
		JSON.stringify(browserErrors, null, 2),
	);
	console.log(
		JSON.stringify({
			assertions: results.length,
			failures: results.filter((r) => !r.passed).length,
			dir,
		}),
	);
	await command("Browser.close");
} finally {
	socket?.close();
	child.kill();
	server.stop(true);
	fs.rmSync(profile, { recursive: true, force: true });
}
