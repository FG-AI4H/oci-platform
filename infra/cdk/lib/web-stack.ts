import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import type { OciEnvConfig } from './environments.js';

export interface WebStackProps extends cdk.StackProps {
  cfg: OciEnvConfig;
  tags: Record<string, string>;
  api: elbv2.ApplicationLoadBalancer;
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
        props.cfg.envName === 'prod' ? cf.PriceClass.PRICE_CLASS_ALL : cf.PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logIncludesCookies: false,
    });

    new cdk.CfnOutput(this, 'CdnUrl', { value: `https://${this.distribution.domainName}` });
  }
}
