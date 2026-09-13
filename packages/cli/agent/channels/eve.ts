import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * The built-in eve HTTP channel replaces the Flue `/agents/*` endpoints.
 *
 * Sessions are created with `POST /eve/v1/session`, streamed from
 * `GET /eve/v1/session/:id/stream`, and continued with
 * `POST /eve/v1/session/:id`.
 *
 * `localDev()` keeps the loopback TUI and REPL open during `eve dev`;
 * `placeholderAuth()` refuses browser requests in production until a real
 * provider is wired in.
 */
export default eveChannel({
	auth: [vercelOidc(), localDev(), placeholderAuth()],
});
