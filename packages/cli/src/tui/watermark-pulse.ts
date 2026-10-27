import {
	CliRenderEvents,
	type CliRenderer,
	RenderableEvents,
	RGBA,
	type TextRenderable,
} from "@opentui/core";
import { THEME } from "./theme";

const PERIOD_MS = 2800;

/** Own one frame callback/live request, only while the agent is busy. */
export function createWatermarkPulse(
	renderer: CliRenderer,
	watermark: TextRenderable,
): (busy: boolean) => void {
	const base = RGBA.fromHex(THEME.watermark);
	const [red, green, blue] = base.toInts();
	let active = false;
	let disposed = false;
	let elapsed = 0;

	const frame = async (deltaTime: number): Promise<void> => {
		if (!active || disposed) return;
		elapsed = (elapsed + deltaTime) % PERIOD_MS;
		// Smoothly dim to 72% and back, without moving or brightening the art.
		const brightness =
			0.86 + 0.14 * Math.cos((2 * Math.PI * elapsed) / PERIOD_MS);
		watermark.fg = RGBA.fromInts(
			Math.round(red * brightness),
			Math.round(green * brightness),
			Math.round(blue * brightness),
		);
	};

	const stop = (): void => {
		if (!active) return;
		active = false;
		renderer.removeFrameCallback(frame);
		renderer.dropLive();
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		stop();
		renderer.off(CliRenderEvents.DESTROY, dispose);
		watermark.off(RenderableEvents.DESTROYED, dispose);
	};
	renderer.once(CliRenderEvents.DESTROY, dispose);
	watermark.once(RenderableEvents.DESTROYED, dispose);

	return (busy) => {
		if (disposed || busy === active) return;
		if (busy) {
			active = true;
			elapsed = 0;
			renderer.setFrameCallback(frame);
			renderer.requestLive();
		} else {
			stop();
			watermark.fg = base;
		}
	};
}
