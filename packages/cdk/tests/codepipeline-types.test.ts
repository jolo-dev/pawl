import type { IRepository } from "aws-cdk-lib/aws-codecommit";
import type { CodeCommitPipelineSource } from "../src/pipeline/source";

declare const repository: IRepository;

const createSource: CodeCommitPipelineSource = {
	origin: "codecommit",
	create: true,
	repositoryName: "created-repository",
	description: "Created repository",
	branchName: "develop",
	sync: ".",
};
const importSource: CodeCommitPipelineSource = {
	origin: "codecommit",
	create: false,
	repositoryName: "imported-repository",
	branchName: "main",
};
const suppliedSource: CodeCommitPipelineSource = {
	origin: "codecommit",
	repository,
	repositoryName: "literal-fallback",
	branchName: "release",
};

// @ts-expect-error sync belongs only to create ownership
const importWithSync: CodeCommitPipelineSource = {
	origin: "codecommit",
	create: false,
	repositoryName: "imported-repository",
	sync: ".",
};

// @ts-expect-error supplied repository ownership cannot also request creation
const repositoryWithCreate: CodeCommitPipelineSource = {
	origin: "codecommit",
	repository,
	create: true,
	repositoryName: "created-repository",
};

// @ts-expect-error CodeCommit sources must select create, import, or supplied ownership
const missingOwnership: CodeCommitPipelineSource = {
	origin: "codecommit",
};

void [
	createSource,
	importSource,
	suppliedSource,
	importWithSync,
	repositoryWithCreate,
	missingOwnership,
];
