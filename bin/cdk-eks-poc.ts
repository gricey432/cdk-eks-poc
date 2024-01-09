#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkEksPocStack } from '../lib/cdk-eks-poc-stack';

const env: cdk.Environment = {
    account: "FILL ME IN",
    region: "ap-southeast-2",
}
const vpcId = "FILL ME IN";

const app = new cdk.App();
new CdkEksPocStack(app, 'CdkEksPocStack', {
    env,
    vpcId,
});