/**
 * The real AWS dependencies for the pre-flight.
 *
 * Kept apart from `preflight.ts` so the control flow stays testable and this
 * wiring is the only place that knows about the credentials and catalog modules.
 * Those modules are unchanged, so their own tests still cover the logic.
 */

import { parseKnownFiles } from "@smithy/core/config";
import {
	checkBedrockAccess,
	checkCredentials,
	getProfileRegion,
	isSSOTokenValid,
	listProfiles,
	ssoLogin,
} from "../aws-credentials";
import { listBedrockModelGroups } from "../bedrock-models";
import type { PreflightDeps } from "./preflight";

export function defaultPreflightDeps(): PreflightDeps {
	return {
		listProfiles,
		profileRegion: getProfileRegion,
		isSso: async (profile) => {
			const profiles = await parseKnownFiles({});
			return Boolean(profiles[profile]?.sso_session);
		},
		isSsoTokenValid: isSSOTokenValid,
		checkCredentials: async (profile, region) => {
			// The pre-flight only needs to know it worked; the identity itself is
			// not used here.
			await checkCredentials(profile, region);
		},
		ssoLogin: (profile, report) => ssoLogin(profile, report),
		listModelGroups: listBedrockModelGroups,
		checkBedrockAccess: (profile, region) =>
			checkBedrockAccess(profile, region),
	};
}
