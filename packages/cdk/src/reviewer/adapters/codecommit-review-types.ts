export type PullRequestSnapshot = {
  provider: "codecommit";
  repositoryName: string;
  pullRequestId: string;
  status: "OPEN" | "CLOSED" | "MERGED";
  sourceReference: string;
  destinationReference: string;
  sourceCommit: string;
  destinationCommit: string;
  revisionId: string;
};

export type ReviewLocation = {
  filePath: string;
  filePosition: number;
  relativeFileVersion: "BEFORE" | "AFTER";
};

export type BlobMetadata = {
  blobId: string;
  path: string;
  mode: string;
};

export type ChangedFile = {
  changeType: "ADDED" | "MODIFIED" | "DELETED";
  before?: BlobMetadata;
  after?: BlobMetadata;
};

export type FileBlob = {
  commitId: string;
  blobId: string;
  filePath: string;
  fileMode: string;
  fileSize: number;
  isBinary: boolean;
  content?: string;
};

export type ReviewComment = {
  commentId: string;
  content: string;
  authorArn: string;
  inReplyTo?: string;
  location?: ReviewLocation;
  createdAt?: string;
  updatedAt?: string;
};

export type PostCommentInput = {
  snapshot: PullRequestSnapshot;
  content: string;
  location?: ReviewLocation;
  clientRequestToken: string;
};

export type UpdateCommentInput = {
  commentId: string;
  originalBody: string;
  appendedBody: string;
};

export type CodeCommitReviewTransport = {
  send(command: unknown): Promise<unknown>;
};
