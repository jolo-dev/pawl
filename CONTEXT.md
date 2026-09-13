# Pawl

Pawl provides opinionated AWS infrastructure constructs and their documentation. This glossary records distinctions agreed while designing how construct relationships are explained and how a project's infrastructure is compared with a live AWS account.

## Language

### Construct relationships

**Supported target type**:
A construct type that a Pawl construct accepts as a receiver of requests or events. For example, the supported route target types for ApiGateway are LambdaFunction and EventBridge; support does not imply that either has been configured in a particular application.
_Avoid_: Configured target or Deployed resource when only type support is known.

**Configured target**:
A particular receiving construct supplied in an application's configuration. It is distinct from the set of target types that the sending construct supports.
_Avoid_: Client, consumer

### Infrastructure states

A resource moves through these states in order, and reaching a later state is not implied by reaching an earlier one.

**Synthesized resource**:
A resource that a project's infrastructure code declares, as reported by synthesizing that code. A synthesized resource may never have been deployed.
_Avoid_: Planned resource, intended resource

**Deployed resource**:
A resource that an AWS account reports through an AWS API. A deployed resource may have no synthesized counterpart, because it was created outside the infrastructure code.
_Avoid_: Inventory item, live resource, provisioned resource

**Drift**:
A difference between the synthesized resources of a project and the deployed resources of one account and region. Drift is directional: a synthesized resource with no deployed counterpart was never deployed, and the reverse was created outside the code.
_Avoid_: Divergence, mismatch

### Reading infrastructure

**Codebase scan**:
A read of a project's local files, describing what the project contains.
_Avoid_: Repository scan

**Resource scan**:
A point-in-time read of the deployed resources in one account and region, carried together with the coverage it achieved. A resource scan reports current state and never history, and it reports the services it could not read rather than implying those services are empty.
_Avoid_: Inventory, topology, sweep

**Suggestion**:
A proposed replacement of a Deployed resource with the Pawl construct that would produce it. A suggestion is advisory and is never applied without approval.
_Avoid_: Recommendation, finding, fix
