# Terraform contra o MiniStack local (ADR 0012) — zero custo AWS real.
# Uso:
#   cd infra/terraform
#   terraform init
#   terraform apply -auto-approve
#
# Requer: MiniStack em http://127.0.0.1:4566 e AWS_* de teste no ambiente.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    s3         = var.aws_endpoint
    sqs        = var.aws_endpoint
    sns        = var.aws_endpoint
    events     = var.aws_endpoint
    lambda     = var.aws_endpoint
  }
}

variable "aws_endpoint" {
  type    = string
  default = "http://127.0.0.1:4566"
}

resource "aws_s3_bucket" "kb" {
  bucket = "orla-kb"
}

resource "aws_sqs_queue" "ingest_dlq" {
  name = "orla-ingestao-dlq"
}

resource "aws_sqs_queue" "ingest" {
  name = "orla-ingestao"
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingest_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sns_topic" "events" {
  name = "orla-eventos"
}

resource "aws_cloudwatch_event_bus" "orla" {
  name = "orla"
}

output "sns_topic_arn" {
  value = aws_sns_topic.events.arn
}

output "event_bus_name" {
  value = aws_cloudwatch_event_bus.orla.name
}

output "kb_bucket" {
  value = aws_s3_bucket.kb.bucket
}
