# Alerts & Operations

Pawl constructs emit CloudWatch alarms and a dashboard automatically. This
guide lists what's monitored and the runbooks for operational incidents.

## Dashboard

A single `AWS::CloudWatch::Dashboard` is synthesized per stack, aggregating
metrics for the reviewer, router, CodeBuild projects, the SQS DLQ, and the
DynamoDB state table.

## Alarms Pawl emits

| Source                | Alarm              | Trigger                               |
| --------------------- | ------------------ | ------------------------------------- |
| CodeBuild project     | Failed-build alarm | Build failures over a rolling window. |
| SQS dead-letter queue | DLQ depth alarm    | Messages accumulate in the event DLQ. |
| DynamoDB state table  | Throttling alarm   | Throttled read/write requests.        |

## Runbooks

### DLQ replay

When EventBridge cannot deliver an event to the router (after retries), it
lands in the SQS DLQ.

1. Inspect the DLQ messages in the SQS console (or `aws sqs receive-message`).
2. Determine the failure cause (e.g. router throttled, malformed event).
3. Re-post the event to EventBridge:

   ```bash
   aws events put-events --entries file://replay-event.json
   ```

4. Delete the replayed message from the DLQ.

### Durable execution stop

To stop a stuck reviewer execution:

```bash
aws lambda update-durable-execution \
  --function-name <reviewer-function> \
  --execution-id <execution-id> \
  --status STOPPED
```

Or use the Lambda console's durable executions view. The next event for that
generation starts a fresh execution.

### Replay / callback failures

Symptoms: a review cycle appears stuck (no findings posted, no terminal state).

1. Check the reviewer's CloudWatch logs for `registerCallback` / `waitForCallback`.
2. Verify the router received the triggering event (router logs + state table).
3. If a callback was lost, deliver a new event for the same generation — the
   router signals the pending callback and the reviewer resumes.

### CodeBuild build failures

1. Open the failed build in the CodeBuild console.
2. Logs are bounded (4 KB/check) and scrubbed (AWS tokens/keys redacted); for
   full logs use the CodeBuild console directly.
3. If the failure is infrastructure (`FAULT`/`STOPPED`), the reviewer marks the
   check `infrastructure-failure` and retries per the workflow's policy.

## Cost metrics

Monitor in the dashboard: Lambda invocations + duration (reviewer/router),
CodeBuild build minutes, Bedrock input/output tokens, DynamoDB read/write
capacity, and SQS requests.
