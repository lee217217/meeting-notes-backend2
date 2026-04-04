exports.handler = async (event) => {
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

  function normalizeActionItems(items) {
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
      if (typeof item === "string") {
        return {
          task: item.trim(),
          owner: "TBD",
          due_date: "TBD",
          priority: "Medium"
        };
      }

      return {
        task: String(item?.task || "").trim() || "TBD",
        owner: String(item?.owner || "").trim() || "TBD",
        due_date: String(item?.due_date || "").trim() || "TBD",
        priority: ["High", "Medium", "Low"].includes(String(item?.priority || "").trim())
          ? String(item.priority).trim()
          : "Medium"
      };
    }).filter(item => item.task);
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

    const meetingTypeInstructions = {
      "General": "Focus on the overall summary, practical action items, and a clear follow-up email.",
      "Client call": "Emphasize client requests, promises made, deadlines, and next follow-up actions.",
      "Internal sync": "Emphasize decisions, blockers, responsibilities, and immediate next steps.",
      "Project review": "Emphasize progress updates, risks, issues, owners, and project milestones.",
      "Sales call": "Emphasize customer needs, objections, commercial follow-ups, and next sales actions."
    };

    const extraInstruction =
      meetingTypeInstructions[meetingType] || meetingTypeInstructions["General"];

    const prompt = `
You are an AI assistant that turns meeting transcripts into structured notes.

Meeting title: ${meetingTitle || "(not provided)"}
Meeting type: ${meetingType}
Output language: ${language}

Instructions:
- ${extraInstruction}
- Return ONLY valid JSON.
- Do not include markdown.
- Do not use code fences.
- Do not add explanations before or after the JSON.
- If an owner or due date is unclear, use "TBD".
- Priority must be one of: High, Medium, Low.

Use exactly this schema:
{
  "summary": "one-paragraph high level summary in the requested language",
  "action_items": [
    {
      "task": "clear action item sentence",
      "owner": "person responsible or TBD",
      "due_date": "deadline/date or TBD",
      "priority": "High or Medium or Low"
    }
  ],
  "follow_up_email": "a short follow-up email draft in the requested language",
  "markdown": "full markdown version of the meeting notes in the requested language"
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
            content:
              "You output strict JSON only. No markdown code fences. No commentary. Start with { and end with }."
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
        body: JSON.stringify({
          error: message,
          details: data
        })
      };
    }

    const rawContent = data?.choices?.?.message?.content || "";
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
          rawContent
        })
      };
    }

    const summary = String(parsed?.summary || "").trim();
    const actionItems = normalizeActionItems(parsed?.action_items);
    const followUpEmail = String(parsed?.follow_up_email || "").trim();
    let markdown = String(parsed?.markdown || "").trim();

    if (!markdown) {
      const actionLines = actionItems.length
        ? actionItems
            .map(
              (item) =>
                `- [ ] ${item.task} — Owner: ${item.owner}; Due: ${item.due_date}; Priority: ${item.priority}`
            )
            .join("\n")
        : "- No action items identified.";

      markdown = `# ${meetingTitle || "Meeting Notes"}

## Summary
${summary || "No summary generated."}

## Action Items
${actionLines}

## Follow-up Email
${followUpEmail || "No follow-up email generated."}`;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        summary,
        action_items: actionItems,
        follow_up_email: followUpEmail,
        markdown
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