# pawl CLI

An AI-powered infrastructure agent that connects to Amazon Bedrock for generating, reviewing, and optimizing AWS infrastructure.

## Features

- **Interactive model selection** — Choose from available Bedrock models (Anthropic, Amazon, Meta, etc.)
- **AWS SSO integration** — Automatic credential management and SSO login flow
- **Infrastructure generation** — Generate CDK code from your codebase using `@pawl/cdk` constructs
- **Well-Architected reviews** — Evaluate infrastructure against all six AWS Well-Architected pillars
- **Cost optimization** — Analyze and suggest cost improvements

## Prerequisites

- AWS account with Bedrock access
- AWS SSO configured (`aws configure sso`)
- Bun runtime

## Usage

```bash
bun run index.ts
```

The CLI will:
1. Prompt you to select an AWS profile
2. Validate credentials (auto-login via SSO if needed)
3. Let you choose a Bedrock model (provider → model → scope → region)
4. Start an interactive agent session

## Built-in Prompts

The CLI includes pre-configured prompts (in `.pi/prompts/`):

- **`@infra`** — Generate AWS CDK infrastructure from your codebase
- **`@well-architected`** — Run a full Well-Architected Framework review
- **`@cost`** — Analyze and optimize AWS costs

## Architecture

Built on [`pi-coding-agent`](https://github.com/nicholasgriffintn/pi-coding-agent) for the interactive TUI and agent session management, with custom AWS credential handling for SSO profiles.
