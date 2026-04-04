export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "PERPLEXITY_API_KEY is missing in Netlify environment variables."
      })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const meetingTitle = (body.meetingTitle || "").trim();
    const language = body.language || "English";
    const meetingType = body.meetingType || "General";
    const notes = (body.notes || "").trim();

    if (!notes) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Transcript is required." })
      };
    }

    const prompt = `
You are an AI assistant that turns meeting transcripts into structured notes.

Meeting title: ${meetingTitle || "(not provided)"}
Meeting type: ${meetingType}
Output language: ${language}

Based on the transcript below, return ONLY valid JSON in this exact schema, no extra text, Do not wrap the JSON in markdown or code fences.
Return raw JSON only.:

{
  "summary": "one-paragraph high level summary in the requested language",
  "action_items": ["list of action items, each as one sentence"],
  "follow_up_email": "a short follow-up email draft in the requested language"
}

Transcript:
${notes}
    `.trim();

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "You output ONLY strict JSON that matches the requested schema. No markdown, no explanations."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(data)
      };
    }

    const rawContent = data?.choices?.?.message?.content || "";

function cleanJsonString(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

const cleanedContent = cleanJsonString(rawContent);

let parsed;
try {
  parsed = JSON.parse(cleanedContent);
} catch (e) {
  parsed = {
    summary: cleanedContent || "No summary generated.",
    action_items: [],
    follow_up_email: ""
  };
}

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        summary: parsed.summary || "",
        action_items: parsed.action_items || [],
        follow_up_email: parsed.follow_up_email || ""
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: error.message || "Unknown server error"
      })
    };
  }
}