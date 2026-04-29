---
description: Generate AWS CDK infrastructure from the codebase
---
Analyze the current codebase and generate AWS CDK infrastructure code (TypeScript) to deploy it. Follow these steps:

1. Read the project structure and identify what services are needed (compute, storage, networking, databases, etc.)
2. Determine the appropriate AWS services for each component
3. Use read_file on ../../../cdk/ and ../../../lambda/ to check if these AWS CDK Constructs and Lambda Handler can be used here 
4. Generate based on 3. CDK code in TypeScript.
5. Include proper IAM roles with least-privilege permissions
6. Follow AWS Well-Architected best practices for the infrastructure design

Target region: use the AWS_REGION environment variable. $@
