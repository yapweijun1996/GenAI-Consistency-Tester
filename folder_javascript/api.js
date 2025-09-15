import { sleep } from './utils.js';
import { filesToInlineParts } from './file-handler.js';

async function extractText(res) {
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ||
         json?.candidates?.[0]?.content?.parts?.[0]?.text ||
         JSON.stringify(json);
}

export async function callGemini({ apiKey, model, prompt, imageParts, temperature, topP, timeoutMs, statusEl }) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  let lastError = null;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const contents = [{
        role: 'user',
        parts: [{ text: prompt }, ...imageParts]
      }];

      const config = {
        temperature: temperature,
        ...(topP > 0 && { topP: topP }),
        response_mime_type: 'text/plain'
      };

      const body = {
        contents,
        "safetySettings": [
          {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": "BLOCK_NONE"
          }
        ],
        "generationConfig": {
          ...config,
          "thinkingConfig": {
            "thinkingBudget": 0
          }
        }
      };

      console.log('Request body:', JSON.stringify(body, null, 2));

      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const t1 = performance.now();
      clearTimeout(timeoutId);

      if (res.ok) {
        return { text: await extractText(res), latency: Math.round(t1 - t0) };
      }

      if (res.status === 503 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`); // Retryable error
      }

      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${errText}`); // Non-retryable

    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err.name === 'AbortError' ? new Error(`Timeout`) : err;

      if (i < MAX_RETRIES - 1) {
        const originalStatus = statusEl.textContent;
        statusEl.textContent = `Request failed (${lastError.message}), retrying ${i + 1}/${MAX_RETRIES - 1}...`;
        await sleep(RETRY_DELAY_MS * (i + 1));
        statusEl.textContent = originalStatus;
      }
    }
  }
  throw lastError || new Error("Request failed after multiple retries.");
}