exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  try {
    const {
      meetingTitle = '',
      meetingType = 'General',
      language = 'English',
      notes = ''
    } = JSON.parse(event.body || '{}');

    if (!notes.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Meeting notes are required.' })
      };
    }

    const POE_API_KEY = process.env.POE_API_KEY || '';
    const POE_MODEL = process.env.POE_MODEL || 'GPT-3.5-Turbo';

    if (!POE_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'POE_API_KEY is missing in Netlify environment variables.' })
      };
    }

    const prompt = `You are an expert meeting assistant.
Return valid JSON only. Do not include markdown fences.

Required JSON schema:
{
  "summary": "string",
  "action_items": ["string", "string"],
  "follow_up_email": "string"
}

Instructions:
- Output language must be: ${language}
- Meeting title: ${meetingTitle || 'Untitled meeting'}
- Meeting type: ${meetingType}
- Create a concise but useful summary.
- Extract concrete action items. If an owner is known, include the owner.
- Write a professional follow-up email draft.
- If the notes are rough, infer structure carefully but do not invent major facts.

Meeting notes:
${notes}`;

    const response = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${POE_API_KEY}`
      },
      body: JSON.stringify({
        model: POE_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'You are a precise meeting summarization assistant that always returns clean JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: rawText })
      };
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Invalid JSON returned by Poe API.' })
      };
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'No content returned from the model.' })
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const cleaned = content
        .replace(/^```json\s*/i, '')
        .replace(/^```/, '')
        .replace(/```$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parsed)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Unknown function error.' })
    };
  }
};