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

# DynamoDB
resource "aws_dynamodb_table" "main" {
  name         = "${local.name}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "lineUserId"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "lineUserId-index"
    hash_key        = "lineUserId"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = { App = local.app, Env = local.env }
}

# IAM Role
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
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Lambda: auth
resource "aws_lambda_function" "auth" {
  function_name = "${local.name}-auth"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "../backend/lambda-auth.zip"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME            = aws_dynamodb_table.main.name
      FROM_EMAIL            = var.from_email
      FRONTEND_URL          = var.frontend_url
      LINE_LOGIN_CHANNEL_ID = var.line_login_channel_id
    }
  }
}

# Lambda: diary
resource "aws_lambda_function" "diary" {
  function_name = "${local.name}-diary"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "../backend/lambda-diary.zip"
  timeout       = 30

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
    }
  }
}

# Lambda: stripe
resource "aws_lambda_function" "stripe_fn" {
  function_name = "${local.name}-stripe"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
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

# API Gateway HTTP API
resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# Integrations
resource "aws_apigatewayv2_integration" "auth" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "diary" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.diary.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "stripe_int" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.stripe_fn.invoke_arn
  payload_format_version = "2.0"
}

# Routes
resource "aws_apigatewayv2_route" "auth_any" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /auth/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "diary_root" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /diary"
  target    = "integrations/${aws_apigatewayv2_integration.diary.id}"
}

resource "aws_apigatewayv2_route" "diary_date" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /diary/{date}"
  target    = "integrations/${aws_apigatewayv2_integration.diary.id}"
}

resource "aws_apigatewayv2_route" "stripe_any" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /stripe/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.stripe_int.id}"
}

# Lambda Permissions
resource "aws_lambda_permission" "auth" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "diary" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.diary.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "stripe_perm" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stripe_fn.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# Variables
variable "from_email" {
  type = string
}

variable "frontend_url" {
  type = string
}

variable "stripe_secret_key" {
  type      = string
  sensitive = true
}

variable "stripe_price_id" {
  type = string
}

variable "stripe_webhook_secret" {
  type      = string
  sensitive = true
}

variable "line_login_channel_id" {
  type = string
}

# Outputs
output "api_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "dynamo_table" {
  value = aws_dynamodb_table.main.name
}
