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

  function cleanText(text) {
    return String(text || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  function extractFirstJsonObject(text) {
    const str = cleanText(text);
    const firstBrace = str.indexOf("{");
    if (firstBrace === -1) return null;

    let inString = false;
    let escape = false;
    let depth = 0;

    for (let i = firstBrace; i < str.length; i++) {
      const ch = str[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;

        if (depth === 0) {
          return str.slice(firstBrace, i + 1);
        }
      }
    }

    return null;
  }

  function safeJsonParse(text) {
    const attempts = [
      cleanText(text),
      extractFirstJsonObject(text)
    ].filter(Boolean);

    for (const candidate of attempts) {
      try {
        return JSON.parse(candidate);
      } catch (e) {}
    }

    return null;
  }

  function normalizePriority(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "high") return "High";
    if (v === "low") return "Low";
    return "Medium";
  }

  function normalizeActionItems(items) {
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
      if (typeof item === "string") {
        return {
          task: item.trim() || "TBD",
          owner: "TBD",
          due_date: "TBD",
          priority: "Medium"
        };
      }

      return {
        task: String(item?.task || "").trim() || "TBD",
        owner: String(item?.owner || "").trim() || "TBD",
        due_date: String(item?.due_date || "").trim() || "TBD",
        priority: normalizePriority(item?.priority)
      };
    }).filter(item => item.task);
  }

  function buildMarkdown(title, summary, actionItems, followUpEmail) {
    const actionLines = actionItems.length
      ? actionItems
          .map((item) =>
            `- [ ] ${item.task} — Owner: ${item.owner}; Due: ${item.due_date}; Priority: ${item.priority}`
          )
          .join("\n")
      : "- No action items identified.";

    return `# ${title || "Meeting Notes"}

## Summary
${summary || "No summary generated."}

## Action Items
${actionLines}

## Follow-up Email
${followUpEmail || "No follow-up email generated."}`;
  }

  async function callPerplexity(messages, useSchema = false) {
    const payload = {
      model: "sonar",
      messages,
      temperature: 0.2
    };

    if (useSchema) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: "meeting_notes_response",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              action_items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    task: { type: "string" },
                    owner: { type: "string" },
                    due_date: { type: "string" },
                    priority: { type: "string" }
                  },
                  required: ["task", "owner", "due_date", "priority"]
                }
              },
              follow_up_email: { type: "string" },
              markdown: { type: "string" }
            },
            required: ["summary", "action_items", "follow_up_email", "markdown"]
          }
        }
      };
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return { response, data };
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

    const mainPrompt = `
You are an AI assistant that turns meeting transcripts into structured notes.

Meeting title: ${meetingTitle || "(not provided)"}
Meeting type: ${meetingType}
Output language: ${language}

Rules:
- ${extraInstruction}
- If an owner or due date is unclear, use "TBD".
- Priority must be High, Medium, or Low.
- Keep the summary concise and useful.
- Write the follow-up email in a professional tone.
- Markdown must include title, summary, action items, and follow-up email.

Transcript:
${notes}
    `.trim();

    let rawContent = "";
    let parsed = null;

    const firstAttempt = await callPerplexity(
      [
        {
          role: "system",
          content: "Return structured meeting notes."
        },
        {
          role: "user",
          content: mainPrompt
        }
      ],
      true
    );

    if (!firstAttempt.response.ok) {
      const message =
        firstAttempt.data?.error?.message ||
        firstAttempt.data?.error ||
        firstAttempt.data?.message ||
        "Perplexity API request failed.";

      return {
        statusCode: firstAttempt.response.status,
        headers,
        body: JSON.stringify({
          error: message,
          details: firstAttempt.data
        })
      };
    }

    rawContent = firstAttempt.data?.choices?.[0]?.message?.content || "";
    parsed = safeJsonParse(rawContent);

    if (!parsed) {
      const secondAttempt = await callPerplexity(
        [
          {
            role: "system",
            content: "Convert the input into valid JSON only."
          },
          {
            role: "user",
            content: `
Convert the following content into valid JSON with exactly this schema:
{
  "summary": "string",
  "action_items": [
    {
      "task": "string",
      "owner": "string",
      "due_date": "string",
      "priority": "High | Medium | Low"
    }
  ],
  "follow_up_email": "string",
  "markdown": "string"
}

If a field is missing, fill with a reasonable fallback.
If owner or due date is unknown, use "TBD".
Return JSON only.

Content to convert:
${rawContent}
            `.trim()
          }
        ],
        false
      );

      if (secondAttempt.response.ok) {
        const retryRaw = secondAttempt.data?.choices?.[0]?.message?.content || "";
        parsed = safeJsonParse(retryRaw);
        if (!parsed) rawContent = retryRaw;
      }
    }

    if (!parsed) {
      const fallbackSummary = cleanText(rawContent).slice(0, 1200) || "No summary generated.";
      const fallbackActionItems = [];
      const fallbackEmail = "Thank you everyone for the meeting. Please find the summary and next steps above.";
      const fallbackMarkdown = buildMarkdown(meetingTitle, fallbackSummary, fallbackActionItems, fallbackEmail);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: fallbackSummary,
          action_items: fallbackActionItems,
          follow_up_email: fallbackEmail,
          markdown: fallbackMarkdown,
          warning: "Model output was not valid JSON. Fallback content was used."
        })
      };
    }

    const summary = String(parsed?.summary || "").trim() || "No summary generated.";
    const actionItems = normalizeActionItems(parsed?.action_items);
    const followUpEmail =
      String(parsed?.follow_up_email || "").trim() ||
      "Thank you everyone for the meeting. Please find the summary and next steps above.";
    const markdown =
      String(parsed?.markdown || "").trim() ||
      buildMarkdown(meetingTitle, summary, actionItems, followUpEmail);

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
};