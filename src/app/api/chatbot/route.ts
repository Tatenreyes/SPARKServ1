import { NextResponse, type NextRequest } from "next/server";
import { getChatbotResponse } from "@/lib/chatbot-rules";

// POST /api/chatbot — no auth required, purely stateless rule matching
export async function POST(request: NextRequest) {
  try {
    const { message, applianceType, issueCategory } = await request.json();

    if ((!message || typeof message !== "string") && !issueCategory) {
      return NextResponse.json({ error: "message (string) is required" }, { status: 400 });
    }

    const response = getChatbotResponse(message, applianceType, issueCategory);
    return NextResponse.json({ data: response });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
