import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getServiceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || "";
  } catch {
    return "";
  }
}

function extractOutputText(payload: any): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  throw new Error("The AI response did not contain structured text.");
}

async function fetchBiblePassage(reference: string) {
  const url = "https://bible-api.com/" + encodeURIComponent(reference) + "?translation=web";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not verify the Bible passage: " + reference);
  const data = await response.json();
  const passage = String(data.text || "").trim();
  if (!passage || !data.reference) throw new Error("The Bible passage lookup returned no text.");
  return { reference: data.reference, text: passage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("DAILY_BIBLE_CRON_SECRET") || "";
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = getServiceKey();
    if (!openAiKey || !supabaseUrl || !serviceKey) {
      throw new Error("Missing OPENAI_API_KEY or Supabase server credentials.");
    }

    const body = await req.json().catch(() => ({}));
    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(body.day_key || "")
      ? body.day_key
      : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing } = await supabase
      .from("daily_bible_content")
      .select("day_key")
      .eq("day_key", dayKey)
      .maybeSingle();
    if (existing) return json({ ok: true, day_key: dayKey, reused: true });

    const prompt = `Create one fresh daily Bible trivia item and one multiple-choice Bible question for a Christian church website.
Use the Protestant 66-book Bible canon. Choose a specific, unambiguous passage reference. The two learning items must both be grounded in that SAME passage and in the actual passage text supplied later.
Do not invent events, people, numbers, quotations, or details. Do not present interpretation as a direct biblical fact. Avoid disputed chronology, disputed authorship, and denominational controversies. Do not write direct Bible quotations; paraphrase faithfully. Keep the content reverent, welcoming, concise, and understandable to teens and adults.
Select a passage reference that is a real, short, self-contained passage. Return only the reference in the first step.`;

    const planRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "bible_passage_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                scripture_reference: { type: "string" },
              },
              required: ["scripture_reference"]
            }
          },
          verbosity: "low"
        }
      })
    });
    if (!planRes.ok) throw new Error("Bible passage planning failed: " + await planRes.text());
    const plan = JSON.parse(extractOutputText(await planRes.json()));
    const passage = await fetchBiblePassage(plan.scripture_reference);

    const contentRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          {
            role: "system",
            content: "You are a careful Bible study editor. Use only the supplied passage text as evidence for the daily trivia and quiz. If the passage does not support a claim, do not include it. Never fabricate quotations or claim a detail is in the passage when it is not."
          },
          {
            role: "user",
            content: "Passage reference: " + passage.reference + "\nPassage text (World English Bible):\n" + passage.text +
              "\n\nCreate the trivia, question, and image prompt based only on this passage. Trivia should be a concise factual discovery (title, short paragraph, category tag, and image caption). The image prompt must depict only details supported by the passage and avoid invented historical specifics. The quiz must have four distinct plausible options, exactly one correct answer, and a clear explanation. Avoid questions that depend on outside Bible knowledge."
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "daily_bible_content",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                trivia: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    tag: { type: "string" },
                    title: { type: "string" },
                    text: { type: "string" },
                    caption: { type: "string" }
                  },
                  required: ["tag", "title", "text", "caption"]
                },
                image_prompt: { type: "string" },
                question: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    q: { type: "string" },
                    c: { type: "array", items: { type: "string" } },
                    a: { type: "integer" },
                    exp: { type: "string" }
                  },
                  required: ["q", "c", "a", "exp"]
                }
              },
              required: ["trivia", "question", "image_prompt"]
            }
          },
          verbosity: "low"
        }
      })
    });
    if (!contentRes.ok) throw new Error("Bible content generation failed: " + await contentRes.text());
    const content = JSON.parse(extractOutputText(await contentRes.json()));
    if (!Array.isArray(content.question?.c) || content.question.c.length !== 4 ||
        !Number.isInteger(content.question.a) || content.question.a < 0 || content.question.a > 3) {
      throw new Error("Generated quiz did not pass answer validation.");
    }

    const imageRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-2.5-flare",
        prompt: "Create a beautiful, reverent, historically inspired biblical illustration for a church daily devotion website. " +
          content.image_prompt + " Depict the passage respectfully and plausibly for its ancient setting. No text, letters, watermark, modern objects, or anachronisms. Wide landscape composition, warm natural light, painterly photorealism.",
        size: "1536x1024",
        quality: "medium",
        output_format: "jpeg",
        output_compression: 82
      })
    });
    if (!imageRes.ok) throw new Error("Daily Bible image generation failed: " + await imageRes.text());
    const imagePayload = await imageRes.json();
    const imageBase64 = imagePayload.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("Image generation returned no image data.");

    const binary = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
    const imagePath = "daily-bible/" + dayKey + ".jpg";
    const { error: uploadError } = await supabase.storage
      .from("church-media")
      .upload(imagePath, binary, { contentType: "image/jpeg", upsert: true });
    if (uploadError) throw new Error("Could not save generated Bible image: " + uploadError.message);

    const { data: publicUrlData } = supabase.storage.from("church-media").getPublicUrl(imagePath);
    const record = {
      day_key: dayKey,
      content: {
        trivia: { ...content.trivia, ref: passage.reference, emoji: "📖", symbol: "📖" },
        question: { ...content.question, ref: passage.reference }
      },
      image_url: publicUrlData.publicUrl,
      updated_at: new Date().toISOString()
    };
    const { error: saveError } = await supabase
      .from("daily_bible_content")
      .upsert(record, { onConflict: "day_key" });
    if (saveError) throw new Error("Could not save daily Bible content: " + saveError.message);

    return json({ ok: true, day_key: dayKey, scripture_reference: passage.reference, image_url: publicUrlData.publicUrl });
  } catch (error) {
    console.error("Daily Bible generation error:", error);
    return json({ error: error instanceof Error ? error.message : "Daily Bible generation failed." }, 500);
  }
});
