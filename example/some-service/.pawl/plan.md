# AWS Infrastructure Plan for some-service

## 1. Application Summary

### Runtime & Framework
- **Runtime**: Node.js 22+ with Bun as package manager and test runner
- **Framework**: AWS CDK with Pawl constructs (@pawl/cdk, @pawl/lambda)
- **Type**: Serverless application with multiple AWS services integration

### Application Components
- **API Gateway**: REST API with Lambda integration
- **Lambda Functions**: Multiple handler functions for different use cases
- **DynamoDB**: Table with streams for event processing
- **EventBridge**: Event bus for event-driven architecture
- **SQS**: Queue for asynchronous processing
- **Authorizers**: Custom Lambda authorizer for API security

### Key Features
- Event-driven architecture using EventBridge
- Real-time data processing with DynamoDB Streams
- API Gateway with custom authorization
- Local development and testing support with LocalStack

## 2. Proposed Architecture

### Services

#### Compute
- **AWS Lambda**: Serverless functions for all business logic
  - API handlers (`api-handler.ts`, `api-test-handler.ts`)
  - EventBridge handler (`eventbridge-user-handler.ts`)
  - DynamoDB Streams handler (`dynamodb-streams-handler.ts`)
  - SQS handler (`sqs-handler.ts`)
  - Authorizer handler (`authorizer-handler.ts`)

#### Storage
- **Amazon DynamoDB**: 
  - Table with streams enabled for real-time data processing
  - Partition key: `id` (STRING type)
  - Stream view type: NEW_AND_OLD_IMAGES

#### Messaging
- **Amazon EventBridge**:
  - Custom event bus (`TestEventBus`)
  - Event pattern: `{ source: ["foo"] }`
  - Targets: Lambda function and SQS queue

- **Amazon SQS**:
  - FIFO queue for reliable message delivery
  - Retry logic configured (3 retries)
  - Message processing via Lambda function

#### API
- **Amazon API Gateway**:
  - REST API with multiple endpoints
  - Custom Lambda authorizer for security
  - Two versions supported (V1 for local development, standard for production)

### Network
- **VPC Configuration**: Default CDK networking (no custom VPC required for this use case)
- **Security Groups**: Automatically managed by CDK
- **Endpoint Configuration**: Public endpoints for API Gateway

### Security
- **IAM Roles**: 
  - Least privilege principle applied to all Lambda functions
  - Automatic role creation by CDK constructs
- **Secrets Management**:
  - API Destination credentials managed via AWS Secrets Manager
  - Basic authentication for API Destination
- **Data Protection**:
  - DynamoDB encryption at rest (default AWS encryption)
  - In-transit encryption for all service interactions

### Observability
- **AWS CloudWatch**:
  - Lambda logs automatically sent to CloudWatch
  - Custom logging implemented in all Lambda handlers
  - Metrics collection via AWS Lambda Powertools
- **X-Ray Tracing**:
  - Enabled for all Lambda functions via Powertools
  - Distributed tracing across services
- **Error Monitoring**:
  - Custom error handling with structured logging
  - Retry mechanisms for failed operations

## 3. Architecture Diagram

```mermaid
graph TD
    subgraph AWS Cloud
        A[API Gateway] -->|REST API| B[Lambda: API Handler]
        A -->|REST API| C[Lambda: API Test Handler]
        D[DynamoDB Table] -->|Stream| E[Lambda: DynamoDB Streams Handler]
        F[EventBridge] -->|Event Pattern: {source: ["foo"]}| B
        F -->|Event Pattern: {source: ["foo"]}| G[SQS FIFO Queue]
        G -->|Message| H[Lambda: SQS Handler]
        I[Lambda: Authorizer Handler] -->|Authorization| A
    end

    subgraph Local Development
        J[LocalStack] -->|Mock AWS Services| K[CDK Local]
        K -->|Deploy Stacks| L[API Gateway (Local)]
        K -->|Deploy Stacks| M[DynamoDB (Local)]
        K -->|Deploy Stacks| N[EventBridge (Local)]
        K -->|Deploy Stacks| O[SQS (Local)]
    end

    B --> D
    C --> D
    E --> D
    H --> D
    
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333,stroke-width:2px
    style C fill:#bbf,stroke:#333,stroke-width:2px
    style D fill:#ffb,stroke:#333,stroke-width:2px
    style E fill:#bbf,stroke:#333,stroke-width:2px
    style F fill:#ff9,stroke:#333,stroke-width:2px
    style G fill:#9f9,stroke:#333,stroke-width:2px
    style H fill:#bbf,stroke:#333,stroke-width:2px
    style I fill:#bbf,stroke:#333,stroke-width:2px
    style J fill:#ff9,stroke:#333,stroke-width:2px
    style K fill:#9f9,stroke:#333,stroke-width:2px
    style L fill:#f9f,stroke:#333,stroke-width:2px
    style M fill:#ffb,stroke:#333,stroke-width:2px
    style N fill:#ff9,stroke:#333,stroke-width:2px
    style O fill:#9f9,stroke:#333,stroke-width:2px
```

### Workflow Explanation

1. **API Requests**: Clients send HTTP requests to API Gateway
2. **Authorization**: API Gateway validates requests using Lambda Authorizer
3. **Business Logic**: API Gateway routes requests to appropriate Lambda functions
4. **Data Storage**: Lambda functions interact with DynamoDB for data persistence
5. **Event Processing**: Events are sent to EventBridge which triggers Lambda and SQS
6. **Asynchronous Processing**: SQS handles messages asynchronously with retry logic
7. **Real-time Updates**: DynamoDB Streams enable real-time data processing

## 4. Deployment Strategy

### Environments
- **Local Development**: 
  - LocalStack for local AWS service simulation
  - CDK Local for infrastructure deployment
  - Hot-reloading via `cdk watch`
- **Staging**: 
  - Isolated AWS account/environment
  - Limited concurrency for cost control
  - Automated testing pipeline
- **Production**:
  - Multi-AZ deployment for high availability
  - Auto-scaling configurations
  - Comprehensive monitoring and alerting

### CI/CD Pipeline
- **GitHub Actions** (implied by project structure):
  - Build and test pipeline
  - Automated deployment to staging
  - Manual approval for production deployment
  - Rollback strategies for failed deployments

### Deployment Process
1. **Bootstrap**: Initialize CDK environment in target AWS account
2. **Synthesis**: Generate CloudFormation templates (`cdk synth`)
3. **Deployment**: Deploy stacks using `cdk deploy`
4. **Validation**: Run integration tests against deployed infrastructure
5. **Monitoring**: Set up CloudWatch alarms and dashboards

### Infrastructure as Code
- **AWS CDK**: Primary IaC tool
- **Pawl Constructs**: Opinionated abstractions over AWS CDK
- **Context Management**:
  - `team` and `stage` context parameters
  - Local vs production differentiation via environment variables

## 5. File Plan

### Source Structure
```
src/
├── api-handler.ts          # Main API handler
├── authorizer-handler.ts   # Custom Lambda authorizer
├── dynamodb-streams-handler.ts # DynamoDB Streams processor
├── eventbridge-user-handler.ts # EventBridge event processor
├── sqs-handler.ts          # SQS message processor
├── utils.ts                # Utility functions
```

### Stack Definitions
```
stacks/
├── dynamodb-streams-stack.ts # DynamoDB with streams setup
├── simple-lambda-stack.ts    # Basic Lambda function
├── simple-api-stack.ts       # API Gateway with Lambda
├── api-with-authorizer-stack.ts # API Gateway with custom authorizer
├── eventbridge-stack.ts      # EventBridge configuration
└── cognito-authorizer-stack.ts # Cognito authorizer (not implemented yet)
```

### Tests
```
tests/
├── simple-api.test.ts       # API Gateway integration tests
└── eventbridge.test.ts      # EventBridge integration tests
```

### Configuration
```
cdk.json                    # CDK configuration
local.dev.ts                # Local development entry point
package.json                # Project dependencies and scripts
tsconfig.json               # TypeScript configuration
```

### Development Scripts
- `bootstrap:local`: Set up LocalStack environment
- `cdklocal`: Deploy to LocalStack
- `deploy`: Deploy to AWS
- `deploy:local`: Deploy to LocalStack
- `test`: Run integration tests

## Next Steps

1. **Review Architecture**: Confirm the proposed architecture meets business requirements
2. **Security Review**: Validate IAM policies and security configurations
3. **Performance Considerations**: Review Lambda memory and timeout settings
4. **Cost Analysis**: Estimate AWS resource costs
5. **Approval**: Get approval to proceed with implementation

This plan provides a comprehensive overview of the infrastructure requirements and serves as a foundation for implementation. All components leverage Pawl's opinionated constructs for consistent, secure, and maintainable AWS infrastructure.