// Runs on Vercel's server. The key comes from the GEMINI_API_KEY environment variable,
// so it is never in your code, on GitHub, or in the browser.
const MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      q: { type: "STRING" },
      options: { type: "ARRAY", items: { type: "STRING" } },
      answer: { type: "INTEGER" },
      explanation: { type: "STRING" }
    },
    required: ["q", "options", "answer", "explanation"]
  }
};

const clean = (v, max = 100) => String(v || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return res.status(500).json({ error: "Server key missing. Add GEMINI_API_KEY in Vercel > Settings > Environment Variables, then redeploy." });

  const b = req.body || {};
  const cls = clean(b.cls), subj = clean(b.subj), topic = clean(b.topic, 150);
  const lang = ["English", "Urdu", "Roman Urdu"].includes(b.lang) ? b.lang : "English";
  const diff = ["Easy", "Medium", "Hard"].includes(b.diff) ? b.diff : "Medium";
  const count = Math.min(Math.max(parseInt(b.count) || 5, 1), 10);
  const part = Math.max(parseInt(b.part) || 1, 1);
  const parts = Math.min(Math.max(parseInt(b.parts) || 1, 1), 4);
  if (!cls || !subj || !topic) return res.status(400).json({ error: "Class, subject and topic are required." });

  const focus = part === 1 ? "the basic ideas and definitions" : part === parts ? "application and problem-solving" : "key concepts and examples";
  const split = parts > 1 ? ` This is part ${part} of ${parts}: cover different sub-areas of the topic than the other parts (part ${part} should focus on ${focus}).` : "";
  const prompt = `Create ${count} multiple-choice questions for ${cls}, subject ${subj}, topic "${topic}". Difficulty: ${diff}. Language: ${lang} (for Roman Urdu, write Urdu in English letters). Age-appropriate and factually correct. Exactly 4 options and exactly one correct answer; spread correct positions. Keep each explanation under 12 words.${split}`;

  let lastErr = "";
  for (const model of MODELS) {
    const gen = { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.6 };
    if (model.startsWith("gemini-2.5")) gen.thinkingConfig = { thinkingBudget: 0 };
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gen })
      });
      if (r.ok) {
        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        return res.status(200).json({ questions: JSON.parse(text) });
      }
      let msg = ""; try { msg = (await r.json()).error.message; } catch (_) {}
      console.error("Gemini error", model, r.status, msg);
      lastErr = `Error ${r.status}${msg ? ": " + msg : ""}`;
      if (r.status === 403 || /API key/i.test(msg)) break;
    } catch (e) {
      console.error(e);
      lastErr = "Could not reach the AI service.";
    }
  }
  res.status(502).json({ error: lastErr || "No response from AI." });
};