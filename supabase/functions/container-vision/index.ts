// container-vision
//
// AI-assisted ISO 6346 container-number reading. The client sends a single
// camera frame (JPEG data URL) after local OCR has failed; this function asks a
// vision model to read the container number and then re-validates the answer
// with the ISO 6346 check digit before returning it. An answer that fails the
// check digit is reported as "not found" so the model can never inject a code.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ISO6346_PATTERN = /^[A-Z]{3}[UJZ]\d{7}$/;
const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

function normalize(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isValidIso6346(code: string) {
  if (!ISO6346_PATTERN.test(code)) return false;
  const body = code.slice(0, 10);
  const total = Array.from(body).reduce((sum, char, index) => {
    const value = /\d/.test(char) ? Number(char) : LETTER_VALUES[char];
    if (value == null) return sum;
    return sum + value * 2 ** index;
  }, 0);
  const remainder = total % 11;
  const expected = remainder === 10 ? 0 : remainder;
  return expected === Number(code.slice(10));
}

function extractCandidates(text: string) {
  const compact = normalize(text);
  const found = new Set<string>();
  for (const match of compact.match(/[A-Z]{4}\d{7}/g) ?? []) found.add(match);
  for (let i = 0; i <= compact.length - 11; i += 1) found.add(compact.slice(i, i + 11));
  return Array.from(found);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { image } = await req.json().catch(() => ({ image: null }));
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "A camera frame is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "You read shipping-container markings from photographs. Reply with ONLY the ISO 6346 container number you can actually read (4 letters then 7 digits, no spaces). It is the code painted on the container door or side, not the ISO size/type code (e.g. 45G1), tare weight, or max gross weight. If you cannot read a complete container number with confidence, reply exactly: NONE",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "What is the container number in this photo?" },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "AI rate limit reached. Try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const detail = await response.text();
      console.error("container-vision gateway error", response.status, detail);
      return new Response(JSON.stringify({ error: "AI container read failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await response.json();
    const text = String(payload?.choices?.[0]?.message?.content ?? "");
    const candidates = extractCandidates(text);
    const containerNumber = candidates.find(isValidIso6346) ?? null;

    return new Response(
      JSON.stringify({
        containerNumber,
        rawText: text.slice(0, 240),
        rejectedCandidates: containerNumber ? [] : candidates.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("container-vision error", error);
    return new Response(JSON.stringify({ error: "AI container read failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
