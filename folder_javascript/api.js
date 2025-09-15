import { sleep } from './utils.js';
import { filesToInlineParts } from './file-handler.js';

/**
 * Extract text from REST response.
 */
async function extractText(res) {
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ||
         json?.candidates?.[0]?.content?.parts?.[0]?.text ||
         JSON.stringify(json);
}

/**
 * Normalize a part to SDK format ({ inlineData } / { text }).
 */
function toSdkPart(p) {
  if (!p) return p;
  if (p.inlineData || p.inline_data) {
    const id = p.inlineData || p.inline_data;
    return { inlineData: { data: id.data, mimeType: id.mimeType || id.mime_type } };
  }
  if (typeof p.text === 'string') return { text: p.text };
  return p;
}

/**
 * Normalize a part to REST format ({ inline_data } / { text }).
 */
function toRestPart(p) {
  if (!p) return p;
  if (p.inline_data || p.inlineData) {
    const id = p.inline_data || p.inlineData;
    return { inline_data: { data: id.data, mime_type: id.mime_type || id.mimeType } };
  }
  if (typeof p.text === 'string') return { text: p.text };
  return p;
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

/**
 * Client-first Gemini call with REST fallback.
 * - Tries @google/generative-ai via dynamic ESM import (https://esm.run/@google/generative-ai)
 * - Falls back to existing REST POST if SDK path fails
 */
export async function callGemini({ apiKey, model, prompt, imageParts, temperature, topP, timeoutMs, statusEl }) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  let lastError = null;

  // Separate generation config shapes for SDK vs REST
  const sdkGenerationConfig = {
    temperature: temperature,
    ...(topP > 0 && { topP }),
    responseMimeType: 'text/plain',
  };
  const restGenerationConfig = {
    temperature: temperature,
    ...(topP > 0 && { topP }),
    response_mime_type: 'text/plain',
  };

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // 1) SDK path with timeout protection
      try {
        const t0 = performance.now();
        const sdkPromise = (async () => {
          const { GoogleGenerativeAI } = await import('https://esm.run/@google/generative-ai');
          const genAI = new GoogleGenerativeAI(apiKey);

          const client = genAI.getGenerativeModel({
            model,
            generationConfig: sdkGenerationConfig,
            safetySettings: SAFETY_SETTINGS,
          });

          const parts = [{ text: prompt }, ...((imageParts || []).map(toSdkPart))];

          // Use object form to be resilient across SDK versions
          const result = await client.generateContent({
            contents: [{ role: 'user', parts }],
          });

          const response = result?.response;
          const text = typeof response?.text === 'function'
            ? response.text()
            : response?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

          const t1 = performance.now();
          if (!text) throw new Error('Empty SDK response');
          return { text, latency: Math.round(t1 - t0) };
        })();

        // Manual timeout for SDK path (since AbortController may not propagate)
        const sdkResult = await Promise.race([
          sdkPromise,
          (async () => {
            await sleep(timeoutMs);
            throw new Error('Timeout');
          })(),
        ]);
        return sdkResult;
      } catch (sdkErr) {
        // Continue to REST fallback
        console.warn('[SDK path failed, falling back to REST]', sdkErr);
      }

      // 2) REST fallback (original logic, preserved)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const contents = [{
          role: 'user',
          parts: [{ text: prompt }, ...((imageParts || []).map(toRestPart))],
        }];

        const body = {
          contents,
          safetySettings: SAFETY_SETTINGS,
          generationConfig: {
            ...restGenerationConfig,
            thinkingConfig: { thinkingBudget: 0 },
          },
        };

        console.log('Request body (REST):', JSON.stringify(body, null, 2));

        const t0 = performance.now();
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const t1 = performance.now();

        clearTimeout(timeoutId);

        if (res.ok) {
          return { text: await extractText(res), latency: Math.round(t1 - t0) };
        }

        if (res.status === 503 || res.status === 429) {
          throw new Error(`HTTP ${res.status}`); // Retryable
        }

        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} — ${errText}`); // Non-retryable
      } finally {
        // Ensure timer is cleared even if fetch throws
        try { clearTimeout(timeoutId); } catch {}
      }
    } catch (err) {
      lastError = err?.name === 'AbortError' ? new Error('Timeout') : err;

      if (i < MAX_RETRIES - 1) {
        const originalStatus = statusEl.textContent;
        statusEl.textContent = `Request failed (${lastError.message}), retrying ${i + 1}/${MAX_RETRIES - 1}...`;
        await sleep(RETRY_DELAY_MS * (i + 1));
        statusEl.textContent = originalStatus;
      }
    }
  }

  throw lastError || new Error('Request failed after multiple retries.');
}