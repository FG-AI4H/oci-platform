# AWS Security Hub Remediation — 2 March 2026

## Summary

Remediated multiple AWS Security Hub findings in account 601883093460 (TSB-DEV-FGAI4H), covering RDS public access, Elasticsearch exposure, unrestricted security groups, and ECR container image vulnerabilities.

---

## [RDS.2] RDS instances should not be publicly accessible

**Finding**: Both Aurora PostgreSQL instances (`gi-ai4h-eval-prod-db-cluster-instance`, `gi-ai4h-eval-staging-db-cluster-instance-v2`) were publicly accessible.

**Root cause**: EC2 server, ECS workers, and RDS were in three separate VPCs with overlapping CIDRs (10.0.0.0/16), making VPC peering impossible. Public access was the workaround for connectivity.

**Resolution — VPC consolidation**:

1. Created security groups in the RDS VPC (`vpc-0165820af0626153f`):
   - `sg-08dd4d33d1019cf15` (evalai-ec2-server) — ports 80, 443, 8000
   - `sg-01f0b6fe1d86ad899` (evalai-ecs-workers)

2. Added SG-based inbound rules to RDS SG (`sg-09f4c6e9852f9c927`) allowing only the two new SGs on port 5432

3. Migrated ECS workers to RDS VPC subnets (`subnet-0298d47e827849eed`, `subnet-0ed715edd3c0491bc`)

4. Migrated EC2 server:
   - Created AMI `ami-0e380ac2bd1c85cbd` from old instance `i-0eea18cde88174628`
   - Launched new instance `i-03a2a2197a038716d` in RDS VPC
   - Reassociated Elastic IP `3.64.132.163` (no public IP change)
   - Old instance stopped (not terminated, available as fallback)

5. Disabled public access on both RDS instances (`--no-publicly-accessible`)

6. Removed wide-open 0.0.0.0/0 inbound rules from RDS security group

**Resources changed**:

| Resource | Old VPC | New VPC |
|---|---|---|
| EC2 `i-03a2a2197a038716d` | `vpc-03076add1b1efca31` | `vpc-0165820af0626153f` |
| ECS workers | `vpc-077eab2bbb8eaefb0` | `vpc-0165820af0626153f` |
| RDS (prod + staging) | Public access ON | Public access OFF |

---

## [ES.2] Elasticsearch domains should not be publicly accessible

**Finding**: Elasticsearch domain `fhir-se-elasti-imwuuvg89b41` was publicly accessible (no VPC).

**Root cause**: Part of an unused FHIR dev stack (`fhir-service-dev`) deployed via CloudFormation in December 2020. Only 3 documents in the index.

**Resolution**: Deleted the entire CloudFormation stack and its dependency:

1. Deleted `audit-log-mover-dev` stack (dependency, had to be removed first)
2. Emptied all S3 buckets (including versioned objects)
3. Deleted `fhir-service-dev` stack

**Resources removed**: Elasticsearch domain, API Gateway, 5 Lambda functions, 3 DynamoDB tables, 5 S3 buckets, 2 Cognito pools, Glue jobs, Step Functions, KMS keys, IAM roles, CloudWatch alarms.

---

## [EC2.19] Security groups should not allow unrestricted access to high-risk ports

**Finding**: Security group `oci-data-catalog` (`sg-0037e191ae849e83e`) had all TCP ports (0-65535) open to 0.0.0.0/0, including MongoDB (27017).

**Root cause**: Attached to EC2 instance `i-05127a61d260f8684` (`OCI-DATA-CATALOG`) which has been stopped since January 2022 with no public IP.

**Resolution**: Removed all 6 inbound rules from the security group. No impact as the instance is stopped.

---

## ECR Container Image Vulnerabilities (~50K findings)

### Legacy repositories deleted (19 total)

All unused/outdated ECR repositories were deleted to eliminate the bulk of vulnerability findings:

- **Staging images** (last pushed 2021): `evalai-staging-backend`, `evalai-staging-celery`, `evalai-staging-frontend`, `evalai-staging-worker`
- **MLflow images** (2021): `pm-mlflow`, `mlflow-containers`
- **FHIR image** (empty): `fgai4h`
- **Challenge participant images** (2020-2022): `retinopathy-model-evaluation-27-*`, `random-number-generator-*`, `test-one-for-docker-*`, `docker_testing_random_number-*`, `random-docker-challenge-*`
- **CDK asset repos**: `cdk-hnb659fds-*`, `cdk-bes699pdc-*`
- **Unused frontend**: `evalai-production-frontend` (replaced by `evalai-production-frontend-ai4good`)

### Production images rebuilt and pushed

All active production images were rebuilt with updated base images and pushed to ECR:

| Repository | Old push date | New push date |
|---|---|---|
| `evalai-production-backend` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-celery` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-frontend-ai4good` | Jan 2026 | 2 Mar 2026 |
| `evalai-production-worker-py3.9` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-worker-py3.8` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-worker-py3.7` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-remote-worker` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-code-upload-worker` | Aug 2025 | 2 Mar 2026 |
| `evalai-production-worker` | Oct 2025 | 2 Mar 2026 |

### Additional fix

Removed stale hardcoded AWS credentials (`/root/.aws/credentials`) from the EC2 instance. The instance now correctly uses its IAM role (`EvalAI-EC2-Role`) for all AWS API calls. The old access key (`AKIAYYIYHFHKCS7OOPV2`) should be revoked in IAM.

---

## Remaining ECR repositories (production only)

```
evalai-production-backend
evalai-production-celery
evalai-production-frontend-ai4good
evalai-production-worker
evalai-production-remote-worker
evalai-production-code-upload-worker
evalai-production-worker-py3.7
evalai-production-worker-py3.8
evalai-production-worker-py3.9
```
