/**
 * Drift: the difference between what a project's code declares and what an
 * account reports.
 *
 * Matching is deliberately ordered, because the two sides do not describe
 * themselves the same way. CloudFormation gives an authoritative identity —
 * stack plus logical id — but only for resources it manages. Everything else
 * has to be recognised from its own physical name, which Pawl pins and tags
 * (see `./provenance.ts`).
 *
 * The classifier never guesses. A deployed resource that looks Pawl-created but
 * has no synthesized counterpart is `foreign`, not `unmanaged`: it may be drift
 * from this project, or it may belong to another project that shares the same
 * team and stage in the same account, and no data available here distinguishes
 * those cases.
 */

import {
	type PawlProvenance,
	parsePawlName,
	parsePawlTagProvenance,
} from "./provenance";

/** A resource a project's infrastructure code declares. */
export interface SynthesizedResource {
	/** CloudFormation stack the resource belongs to. */
	readonly stackName: string;
	/** CloudFormation logical id. */
	readonly logicalId: string;
	/** CloudFormation resource type, e.g. `AWS::Lambda::Function`. */
	readonly resourceKind: string;
	/** Physical name, when the template pins one. Pawl constructs always do. */
	readonly physicalName?: string | undefined;
}

/** A resource an account reports through an AWS API. */
export interface DeployedResource {
	/** The scanning service, e.g. `lambda`. */
	readonly service: string;
	/** CloudFormation resource type where known. */
	readonly resourceKind: string;
	/** Physical name as the service reports it. */
	readonly physicalName: string;
	readonly arn?: string | undefined;
	/** Owning CloudFormation stack, when the resource is stack-managed. */
	readonly stackName?: string | undefined;
	/** CloudFormation logical id, when the resource is stack-managed. */
	readonly logicalId?: string | undefined;
	readonly tags: Record<string, string | undefined>;
}

export type DriftStatus = "matched" | "not-deployed" | "unmanaged" | "foreign";

/** What a pair was matched on, or why nothing matched. */
export type DriftBasis = "logical-id" | "physical-name" | "provenance" | "none";

export interface DriftEntry {
	readonly status: DriftStatus;
	readonly synthesized?: SynthesizedResource | undefined;
	readonly deployed?: DeployedResource | undefined;
	readonly basis: DriftBasis;
	readonly provenance?: PawlProvenance | undefined;
	/** Short, human-readable explanation, safe to show the user. */
	readonly reason: string;
}

export interface DriftInput {
	readonly synthesized: readonly SynthesizedResource[];
	readonly deployed: readonly DeployedResource[];
}

const stackKey = (stackName: string, logicalId: string): string =>
	`${stackName}\u0000${logicalId}`;

export function classifyDrift(input: DriftInput): DriftEntry[] {
	const entries: DriftEntry[] = [];

	const synthByLogicalId = new Map<string, SynthesizedResource>();
	const synthByPhysicalName = new Map<string, SynthesizedResource>();
	for (const resource of input.synthesized) {
		synthByLogicalId.set(
			stackKey(resource.stackName, resource.logicalId),
			resource,
		);
		if (resource.physicalName) {
			synthByPhysicalName.set(resource.physicalName, resource);
		}
	}

	const consumed = new Set<SynthesizedResource>();

	for (const resource of input.deployed) {
		const byLogicalId =
			resource.stackName && resource.logicalId
				? synthByLogicalId.get(stackKey(resource.stackName, resource.logicalId))
				: undefined;
		if (byLogicalId && !consumed.has(byLogicalId)) {
			consumed.add(byLogicalId);
			entries.push({
				status: "matched",
				synthesized: byLogicalId,
				deployed: resource,
				basis: "logical-id",
				reason: `${resource.physicalName} is ${byLogicalId.logicalId} in ${byLogicalId.stackName}.`,
			});
			continue;
		}

		const byPhysicalName = synthByPhysicalName.get(resource.physicalName);
		if (byPhysicalName && !consumed.has(byPhysicalName)) {
			consumed.add(byPhysicalName);
			entries.push({
				status: "matched",
				synthesized: byPhysicalName,
				deployed: resource,
				basis: "physical-name",
				reason: `${resource.physicalName} matches the name ${byPhysicalName.logicalId} pins.`,
			});
			continue;
		}

		const provenance =
			parsePawlName(resource.physicalName) ??
			parsePawlTagProvenance(resource.tags);
		if (provenance) {
			entries.push({
				status: "foreign",
				deployed: resource,
				basis: "provenance",
				provenance,
				reason: `${resource.physicalName} carries Pawl provenance but no synthesized counterpart; it may belong to another project sharing this team and stage.`,
			});
			continue;
		}

		entries.push({
			status: "unmanaged",
			deployed: resource,
			basis: "none",
			reason: `${resource.physicalName} was created outside the infrastructure code.`,
		});
	}

	for (const resource of input.synthesized) {
		if (consumed.has(resource)) continue;
		entries.push({
			status: "not-deployed",
			synthesized: resource,
			basis: "none",
			reason: `${resource.logicalId} in ${resource.stackName} was never deployed.`,
		});
	}

	return entries;
}
