# Pawl

Pawl provides opinionated AWS infrastructure constructs and their documentation. This glossary records distinctions agreed while designing how construct relationships are explained.

## Language

**Supported target type**:
A construct type that a Pawl construct accepts as a receiver of requests or events. For example, the supported route target types for ApiGateway are LambdaFunction and EventBridge; support does not imply that either has been configured in a particular application.
_Avoid_: Configured target or deployed destination when only type support is known.

**Configured target**:
A particular receiving construct supplied in an application's configuration. It is distinct from the set of target types that the sending construct supports.
