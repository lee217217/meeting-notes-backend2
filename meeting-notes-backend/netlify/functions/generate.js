export async function handler(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "PERPLEXITY_API_KEY is missing in Netlify environment variables."
      })
    };
  }

  function cleanJsonString(text) {
    return String(text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const meetingTitle = String(body.meetingTitle || "").trim();
    const language = String(body.language || "English").trim();
    const meetingType = String(body.meetingType || "General").trim();
    const notes = String(body.notes || "").trim();

    if (!notes) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Transcript is required." })
      };
    }

    const prompt = `
You are an AI assistant that turns meeting transcripts into structured notes.

Meeting title: ${meetingTitle || "(not provided)"}
Meeting type: ${meetingType}
Output language: ${language}

Return ONLY valid JSON.
Do not include markdown.
Do not use code fences.
Do not add any explanation before or after the JSON.

Use exactly this schema:
{
  "summary": "one-paragraph high level summary in the requested language",
  "action_items": ["list of action items, each as one sentence"],
  "follow_up_email": "a short follow-up email draft in the requested language"
}

Transcript:
${notes}
    `.trim();

    const pplxResponse = await fetch("https://api.perplexity.ai/chat/completions", {
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
            content: "You output strict JSON only. No markdown. No code fences. No commentary."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2
      })
    });

    const data = await pplxResponse.json();

    if (!pplxResponse.ok) {
      const message =
        data?.error?.message ||
        data?.error ||
        data?.message ||
        "Perplexity API request failed.";

      return {
        statusCode: pplxResponse.status,
        headers,
        body: JSON.stringify({ error: message, details: data })
      };
    }

    const rawContent = data?.choices?.[0]?.message?.content || "";
    const cleanedContent = cleanJsonString(rawContent);

    let parsed;
    try {
      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Model returned non-JSON output.",
          rawContent: rawContent
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        summary: String(parsed.summary || "").trim(),
        action_items: Array.isArray(parsed.action_items)
          ? parsed.action_items.map(item => String(item).trim()).filter(Boolean)
          : [],
        follow_up_email: String(parsed.follow_up_email || "").trim()
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || "Unknown server error"
      })
    };
  }
}