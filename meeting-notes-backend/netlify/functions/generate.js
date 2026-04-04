export async function handler(event) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      httpMethod: event.httpMethod,
      headers: event.headers,
      rawBody: event.body,
      parsedBody: (() => {
        try {
          return JSON.parse(event.body || "{}");
        } catch (e) {
          return { parseError: e.message };
        }
      })()
    })
  };
}