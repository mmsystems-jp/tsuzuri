terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region  = "ap-northeast-1"
  profile = "mmsystems"
}

locals {
  app  = "tsuzuri"
  env  = "prod"
  name = "${local.app}-${local.env}"
}

# ── DynamoDB ──────────────────────────────────────────────────────
resource "aws_dynamodb_table" "main" {
  name         = "${local.name}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute { name = "PK";    type = "S" }
  attribute { name = "SK";    type = "S" }
  attribute { name = "email"; type = "S" }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = { App = local.app, Env = local.env }
}

# ── IAM Role (Lambda共通) ─────────────────────────────────────────
resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"]
        Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail","ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ── Lambda Functions ──────────────────────────────────────────────
resource "aws_lambda_function" "auth" {
  function_name = "${local.name}-auth"
  role          = aws_iam_role.lambda.arn
  handler       = "lambda/auth/index.handler"
  runtime       = "nodejs20.x"
  filename      = "../backend/lambda-auth.zip"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.main.name
      FROM_EMAIL   = var.from_email
      FRONTEND_URL = var.frontend_url
    }
  }
}

resource "aws_lambda_function" "diary" {
  function_name = "${local.name}-diary"
  role          = aws_iam_role.lambda.arn
  handler       = "lambda/diary/index.handler"
  runtime       = "nodejs20.x"
  filename      = "../backend/lambda-diary.zip"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
    }
  }
}

resource "aws_lambda_function" "stripe" {
  function_name = "${local.name}-stripe"
  role          = aws_iam_role.lambda.arn
  handler       = "lambda/stripe/index.handler"
  runtime       = "nodejs20.x"
  filename      = "../backend/lambda-stripe.zip"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.main.name
      FRONTEND_URL          = var.frontend_url
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_PRICE_ID       = var.stripe_price_id
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
    }
  }
}

# ── API Gateway ───────────────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api" {
  name = "${local.name}-api"
}

resource "aws_api_gateway_deployment" "deploy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = local.env
}

# ── Variables ─────────────────────────────────────────────────────
variable "from_email"            { type = string }
variable "frontend_url"          { type = string }
variable "stripe_secret_key"     { type = string; sensitive = true }
variable "stripe_price_id"       { type = string }
variable "stripe_webhook_secret" { type = string; sensitive = true }

# ── Outputs ───────────────────────────────────────────────────────
output "api_url"      { value = aws_api_gateway_deployment.deploy.invoke_url }
output "dynamo_table" { value = aws_dynamodb_table.main.name }
