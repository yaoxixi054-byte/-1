import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "100mb" }));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
  console.error("CRITICAL: GEMINI_API_KEY is missing or invalid.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

// ── Stopwords ────────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "am","is","are","was","were","be","been","being",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","mine","yours","hers","ours","theirs",
  "the","a","an","and","of","in","to","with","that","for","on","at","by",
  "from","up","down","as","but","or","so","if","than","then","this","those",
  "these","which","who","whom","whose","what","where","when","how","why",
  "all","any","both","each","few","more","most","other","some","such",
  "no","nor","not","only","own","same","too","very","can","will","just",
  "should","now","about","after","again","against","before","between",
  "during","into","through","under","until","do","did","does","have",
  "has","had","may","might","shall","would","could","also","there",
]);

// ── Prompt ───────────────────────────────────────────────────────────────────
// One prompt that works for both native-text and scanned PDFs.
// For scanned files Gemini will OCR first, then extract.
const EXTRACT_PROMPT = `You are processing a Chinese English-language exam paper (英语试卷).
The document is either a native-text PDF or a scanned image PDF.
If it is scanned, first perform OCR to recover all text, then proceed.

YOUR TASK: Extract every distinct English word that appears anywhere in the document —
including reading passages, fill-in-the-blank sentences, multiple-choice options,
word banks, instructions written in English, and answer keys.

RULES:
1. Treat "books" and "book" as SEPARATE entries (no lemmatization).
2. Lowercase all words before counting.
3. EXCLUDE: single isolated letters (except "a" and "I" which are already in stopwords),
   pure numbers, Chinese characters, punctuation-only tokens.
4. EXCLUDE common stopwords such as: a, an, the, in, on, at, by, from, with, is, are,
   was, were, be, have, has, had, do, did, does, will, would, can, could, may, might,
   shall, should, and, or, but, not, no, nor, so, if, as, for, of, to, up, down, i,
   he, she, we, they, me, him, her, us, them, my, your, his, its, our, their, this,
   that, these, those, which, who, what, where, when, how, why, all, any, some, each,
   few, more, most, other, such, only, also, just, very, too, now, after, before,
   between, through, about, again, own, same, than, then, there, into, during, under,
   until, both, either, another, already, even.
5. DO NOT include any explanation or markdown. Return ONLY a raw JSON array.

OUTPUT FORMAT (raw JSON array, no code fences, no prose):
[
  {"word": "environment", "pos": "n.", "count": 7},
  {"word": "however", "pos": "adv.", "count": 3}
]

POS abbreviations to use: n. / v. / adj. / adv. / prep. / conj. / pron. / interj. / n/a`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip markdown fences Gemini sometimes wraps around JSON */
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Call Gemini with one retry on failure */
async function callGeminiWithRetry(
  fileData: string,
  mimeType: string,
  fileName: string
): Promise<Array<{ word: string; pos: string; count: number }>> {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[${fileName}] Attempt ${attempt}/${MAX_ATTEMPTS}…`);
      console.time(`[${fileName}] gemini`);

      const response: GenerateContentResponse = await ai.models.generateContent({
        // Using gemini-3-flash-preview for optimal text and PDF extraction
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: EXTRACT_PROMPT },
              {
                inlineData: {
                  data: fileData,
                  mimeType,          // "application/pdf" or "image/jpeg" etc.
                },
              },
            ],
          },
        ],
        // No responseSchema — it makes the model overly conservative with OCR tasks
        config: {
          responseMimeType: "text/plain",   // Let model return free text, we parse ourselves
          temperature: 0,                   // Deterministic output
        },
      });

      console.timeEnd(`[${fileName}] gemini`);

      const raw = response.text ?? "[]";
      const cleaned = stripFences(raw);
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        throw new Error("Response is not a JSON array");
      }

      return parsed;
    } catch (err) {
      console.error(`[${fileName}] Attempt ${attempt} failed:`, err);
      if (attempt === MAX_ATTEMPTS) throw err;
      // Brief pause before retry
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return [];
}

// ── Route ────────────────────────────────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { files } = req.body as {
      files: Array<{ name?: string; data: string; mimeType: string }>;
    };

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided." });
    }

    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const aggregated: Record<string, { count: number; pos: string }> = {};

    for (const file of files) {
      const name = file.name ?? "unknown";
      let items: Array<{ word: string; pos: string; count: number }> = [];

      try {
        items = await callGeminiWithRetry(file.data, file.mimeType, name);
      } catch (err) {
        console.error(`Skipping file "${name}" after all retries:`, err);
        continue;
      }

      for (const item of items) {
        if (!item.word) continue;

        // Normalize: lowercase, strip leading/trailing non-alpha chars
        const clean = item.word
          .toLowerCase()
          .trim()
          .replace(/^[^a-z]+|[^a-z]+$/g, "");

        // Skip empty, single-char, or stopword tokens
        if (!clean || clean.length <= 1 || STOPWORDS.has(clean)) continue;

        if (aggregated[clean]) {
          aggregated[clean].count += item.count ?? 1;
        } else {
          aggregated[clean] = {
            count: item.count ?? 1,
            pos: item.pos ?? "n/a",
          };
        }
      }
    }

    const result = Object.entries(aggregated)
      .map(([word, { count, pos }]) => ({ word, pos, count }))
      .sort((a, b) => b.count - a.count);

    if (result.length === 0) {
      return res.status(422).json({
        error:
          "No English words could be extracted. " +
          "If your PDF is a scanned image, make sure the scan quality is clear (≥150 DPI). " +
          "Also verify that GEMINI_API_KEY is valid and has access to gemini-3-flash-preview.",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error("Unhandled analysis error:", error);
    return res.status(500).json({
      error: "Internal server error. Check server logs for details.",
    });
  }
});

// ── Vite / Static ─────────────────────────────────────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running → http://localhost:${PORT}`);
  });
}

startServer();
