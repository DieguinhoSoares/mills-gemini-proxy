import jwt from "jsonwebtoken";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://dieguinhosoares.github.io";
const PROXY_SECRET = process.env.PROXY_SECRET;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

let cachedToken = null;
let cachedTokenExpiry = 0;

// Troca a credencial da conta de serviço por um token OAuth2 de acesso.
// Isso é o que o Gemini exige agora pra chaves vinculadas a conta de
// serviço (formato AQ.) - e só pode ser feito com segurança aqui no
// servidor, nunca no navegador, porque exige a chave PRIVADA da conta.
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExpiry - 60) return cachedToken;

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const assertion = jwt.sign(
    {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.private_key,
    { algorithm: "RS256" }
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao obter access token (${response.status}): ${body}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + data.expires_in;
  return cachedToken;
}

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

  // Protege o proxy contra uso por estranhos - só quem souber esse segredo
  // (configurado também no app React) consegue chamar.
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

    const accessToken = await getAccessToken();

    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      res.status(geminiResponse.status).json(data);
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
