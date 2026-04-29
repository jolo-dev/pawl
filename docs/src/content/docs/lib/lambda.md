---
title: Getting Started
description: Overview of the @pawl/lambda handler library.
---

## AWS Lambda Library

`@pawl/lambda` is a typed wrapper around AWS Lambda handlers.
It includes AWS Lambda Powertools and is completely type-safe with Zod validation.

### Why?

This library standardizes Lambda handlers. Developers don't need to worry about configuring the logger, X-Ray tracing, or metrics.
It's a helper library that abstracts away the complexity of raw `aws-lambda` types and Powertools setup.
