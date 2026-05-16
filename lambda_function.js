// ═══════════════════════════════════════════════════════════════
//  StreakFlow Habit Tracker — AWS Lambda Function
//  FILE: lambda_function.js
//  Services used: DynamoDB, SNS
//  How to use: Copy this entire file into your Lambda function editor
// ═══════════════════════════════════════════════════════════════

const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { SNSClient, PublishCommand, SubscribeCommand } = require("@aws-sdk/client-sns");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

// AWS Clients (region is auto-detected from Lambda environment)
const dynamo = new DynamoDBClient({});
const sns = new SNSClient({});

// ── CHANGE THESE to match your setup ──────────────────────────
const TABLE_NAME = "HabitTracker";       // DynamoDB table name
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN || "arn:aws:sns:us-east-1:123456789:HabitAlerts";
// ──────────────────────────────────────────────────────────────

// ══ MAIN HANDLER ══════════════════════════════════════════════
exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // Enable CORS (allows your HTML page to call this API)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight CORS request
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const method = event.httpMethod;
  const path   = event.path || "";
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch(e) {}
  }

  try {

    // ── GET /habits?userId=xxx ─────────────────────────────────
    if (method === "GET" && path.includes("/habits")) {
      const userId = event.queryStringParameters?.userId || "default";
      const result = await dynamo.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: marshall({ ":uid": userId }),
      }));
      const habits = (result.Items || []).map(item => unmarshall(item).habitData);
      return { statusCode: 200, headers, body: JSON.stringify(habits) };
    }

    // ── POST /habits ─────────────────────────────────────────
    if (method === "POST" && path.includes("/habits")) {
      const { userId = "default", habit } = body;
      await dynamo.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          userId:    userId,
          habitId:   habit.id,
          habitData: habit,
          updatedAt: new Date().toISOString(),
        }),
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── DELETE /habits/:id?userId=xxx ─────────────────────────
    if (method === "DELETE" && path.includes("/habits/")) {
      const habitId = path.split("/habits/")[1];
      const userId  = event.queryStringParameters?.userId || "default";
      await dynamo.send(new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ userId, habitId }),
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── POST /subscribe ────────────────────────────────────────
    if (method === "POST" && path.includes("/subscribe")) {
      const { email } = body;
      if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: "Email required" }) };
      await sns.send(new SubscribeCommand({
        TopicArn: SNS_TOPIC_ARN,
        Protocol: "email",
        Endpoint: email,
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Check your email to confirm subscription!" }) };
    }

    // ── POST /notify ──────────────────────────────────────────
    if (method === "POST" && path.includes("/notify")) {
      const { message = "StreakFlow: Don't forget your habits today! 🔥" } = body;
      await sns.send(new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject:  "StreakFlow – Daily Habit Reminder 🔥",
        Message:  message,
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── 404 ───────────────────────────────────────────────────
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Route not found" }) };

  } catch (err) {
    console.error("Lambda error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
