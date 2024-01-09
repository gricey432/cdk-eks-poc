import {
    Stack,
    StackProps,
    aws_eks as eks,
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_lambda as lambda,
    custom_resources as cr,
    Duration,
    CustomResource, CfnOutput, Token
} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {AwsCliLayer} from "aws-cdk-lib/lambda-layer-awscli";
import {KubectlV28Layer} from "@aws-cdk/lambda-layer-kubectl-v28";
import * as path from "path";


interface CdkEksPocStackProps extends StackProps {
    vpcId: string;
}

export class CdkEksPocStack extends Stack {
    constructor(scope: Construct, id: string, props: CdkEksPocStackProps) {
        super(scope, id, props);

        // Some VPC, doesn't matter
        const vpc = ec2.Vpc.fromLookup(this, "vpc", {
            vpcId: props.vpcId,
        });

        /**
         * Role used by the EKS managed control plane to call AWS APIs
         */
        const serviceRole = new iam.Role(this, 'service-role', {
            assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
            ],
        });

        /**
         * Cluster construct
         */
        const cluster = new eks.CfnCluster(this, "cluster", {
            accessConfig: {
                // This demo only needs "API" to work, but I imagine CDK would have to use "API_AND_CONFIG_MAP" for compat
                authenticationMode: "API_AND_CONFIG_MAP",
                bootstrapClusterCreatorAdminPermissions: false,
            },
            resourcesVpcConfig: {
                endpointPrivateAccess: true,
                endpointPublicAccess: true,
                subnetIds: vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC}).subnetIds,
            },
            roleArn: serviceRole.roleArn,

            // Latest at time of writing
            version: "1.28",
        });

        /**
         * The IAM role which will be used by the CDK's kubectl lambda
         */
        const kubectlRole = new iam.Role(this, 'kubectl-role', {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                describe: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                        actions: ['eks:DescribeCluster'],
                        resources: [cluster.attrArn],
                    })]
                })
            }
        });

        /**
         * An AccessEntry to allow the kubectl lambda role access
         */
        new eks.CfnAccessEntry(this, "kubectl-access-entry", {
            clusterName: cluster.ref,
            principalArn: kubectlRole.roleArn,
            accessPolicies: [
                {
                    accessScope: {
                        type: "cluster",
                    },
                    policyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy",
                }
            ]
        });

        /**
         * The Lambda function which runs kubectl
         * The KubectlProvider class requires an eks.Cluster but we've got a CfnCluster in this example
         * We'll just rebuild the parts we need here but in a real implementation this should just be changes to KubectlProvider
         */
        const kubectlFunction = new lambda.Function(this, 'kubectl-handler', {
            /*
             * Source is copied out so we can remove the "--role-arn" arg to "aws eks update-kubeconfig"
             * Could just make 2 roles but demo is shorter just using the one role
             */
            code: lambda.Code.fromAsset(path.join(__dirname, "kubectl-handler")),

            handler: "index.handler",
            runtime: lambda.Runtime.PYTHON_3_10,
            timeout: Duration.minutes(15),
            description: 'onEvent handler for EKS kubectl resource provider',
            memorySize: 1024,
            role: kubectlRole,
            // Skipping VPC stuff for this demo and just using public access from a non-vpc lambda
        });
        kubectlFunction.addLayers(new AwsCliLayer(this, 'AwsCliLayer'));
        kubectlFunction.addLayers(new KubectlV28Layer(this, 'KubectlLayer'));

        const provider = new cr.Provider(this, 'Provider', {
            onEventHandler: kubectlFunction,
        });

        /**
         * Copied out of KubernetesObjectValue since it has an unoverridable reference to KubectlProvider
         */
        const k8sObjectValue = new CustomResource(this, 'object-value', {
            resourceType: 'Custom::AWSCDK-EKS-KubernetesObjectValue',
            serviceToken: provider.serviceToken,
            properties: {
                ClusterName: cluster.ref,
                RoleArn: kubectlRole.roleArn,
                TimeoutSeconds: Duration.seconds(30).toSeconds(),

                // Just filling this out with something that should exist in a new cluster for demo
                ObjectType: "ConfigMap",
                ObjectName: "kube-root-ca.crt",
                ObjectNamespace: "default",
                JsonPath: "$.metadata.uid",
            },
        });

        new CfnOutput(this, "demo-output", {
            value: Token.asString(k8sObjectValue.getAtt('Value')),
        });
    }
}
