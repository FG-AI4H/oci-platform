import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import type { OciEnvConfig } from './environments.js';

export interface WebStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  api: elbv2.ApplicationLoadBalancer;
  /** Shared access-logs bucket (from observability stack). */
  accessLogsBucket: s3.IBucket;
}

/**
 * CloudFront in front of the Next.js app (also Fargate-hosted in a follow-up stack)
 * and the API. Provides global edge caching, TLS, security headers via response policy.
 *
 * For now this stack just wires the API behind CloudFront. The Next.js Fargate service
 * will be added in Phase A2 alongside the API stack to keep things simple.
 */
export class WebStack extends cdk.Stack {
  public readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    Object.entries(props.tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const securityHeaders = new cf.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cf.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(63072000),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; img-src * data:; script-src 'self'",
          override: false,
        },
      },
    });

    this.distribution = new cf.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(props.api, {
          protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_ALL,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeaders,
      },
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      priceClass:
        props.cfg.envName === 'prod'
          ? cf.PriceClass.PRICE_CLASS_ALL
          : cf.PriceClass.PRICE_CLASS_100,
      logBucket: props.accessLogsBucket as s3.Bucket,
      logFilePrefix: `cloudfront/${props.cfg.envName}/`,
      logIncludesCookies: false,
    });

    new cdk.CfnOutput(this, 'CdnUrl', { value: `https://${this.distribution.domainName}` });

    // Suppress findings that are intentional or deferred to Phase A2 (custom domain + ACM).
    NagSuppressions.addResourceSuppressions(this.distribution, [
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'Distribution uses the default *.cloudfront.net certificate during Phase A1/A2 bootstrap, which forces TLSv1 minimum regardless of the configured policy. Will be replaced with an ACM-issued cert and custom domain in Phase A2 (Route 53 zone provisioning), at which point TLSv1.2_2021 takes effect.',
      },
      {
        id: 'AwsSolutions-CFR1',
        reason:
          'OCI Platform serves a global audience under FG-AI4H; geo-restrictions are intentionally not configured. WAF (CFR2) provides L7 protection in prod.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'WAF on CloudFront is a Phase A2 prod hardening item; for now WAFv2 is attached to the regional ALB (api-stack) in int/prod which sits in the request path.',
      },
    ]);
  }
}
