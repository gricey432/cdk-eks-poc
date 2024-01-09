# EKS Cluster without Custom Resource

A quick proof of concept for using the new EKS Access Entries to create a cluster with working kubectl lambda.

This avoids the issue with "principal who created cluster starts as only admin" forcing CDK to make a custom resource.

To execute this you'll need to fill in the env and vpcId in `bin/cdk-eks-poc.ts`.
