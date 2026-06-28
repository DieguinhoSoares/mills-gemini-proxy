const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://dieguinhosoares.github.io";
const PROXY_SECRET = process.env.PROXY_SECRET;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-proxy-secret");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (PROXY_SECRET && req.headers["x-proxy-secret"] !== PROXY_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { mimeType, base64Data, prompt } = req.body;
    if (!mimeType || !base64Data || !prompt) {
      res.status(400).json({ error: "Faltam campos: mimeType, base64Data, prompt" });
      return;
    }

    const isPdf = mimeType === "application/pdf";
    const dataUri = `data:${mimeType};base64,${base64Data}`;
    const fileContent = isPdf
      ? { type: "document_url", document_url: dataUri }
      : { type: "image_url", image_url: dataUri };

    const mistralResponse = await fetch(MISTRAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              fileContent,
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    const data = await mistralResponse.json();

    if (!mistralResponse.ok) {
      res.status(mistralResponse.status).json(data);
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
