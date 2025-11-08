const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOPICS = 12;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Cloudflare Worker entrypoints.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method === "POST") {
      const body = await safeJson(request);
      const targetEmail = body?.email || url.searchParams.get("email");
      if (!targetEmail) {
        return new Response("Provide an email to force-generate.", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      console.log("Manual trigger received", { targetEmail });
      const result = await runDailySummary(env, targetEmail);
      return jsonResponse(result);
    }

    const targetEmail = url.searchParams.get("email") || undefined;
    if (targetEmail) {
      console.log("Manual GET trigger received", { targetEmail });
    }
    const result = await runDailySummary(env, targetEmail);
    return jsonResponse(result);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailySummary(env));
  },
};

async function runDailySummary(env, targetEmail) {
  const startedAt = new Date().toISOString();
  console.log("Daily summary run started", { startedAt, targetEmail });
  try {
    const latestInterests = await fetchLatestInterests(env, targetEmail);
    if (!latestInterests.length) {
      console.log("No interests found", { targetEmail });
      return {
        ok: true,
        startedAt,
        processed: 0,
        message: targetEmail ? `No interests found for ${targetEmail}` : "No interests found",
      };
    }

    const limit = targetEmail ? 1 : Number(env.MAX_USERS_PER_RUN || latestInterests.length);
    const targets = latestInterests.slice(0, limit);
    const results = [];

    for (const entry of targets) {
      console.log("Generating summary", {
        email: entry.email,
        topics: entry.topics,
        updated_at: entry.updated_at,
      });
      const summary = await generateSummary(env, entry);
      await saveSummary(env, {
        user_id: entry.user_id,
        email: entry.email,
        summary_text: summary,
        generated_at: new Date().toISOString(),
      });
      console.log("Summary saved", {
        email: entry.email,
        summaryPreview: summary.slice(0, 80),
      });
      results.push({ email: entry.email, topics: entry.topics, summary });
      // Cloudflare automatically enforces timeouts; loop sequentially to stay safe.
      await wait(300);
    }

    console.log("Daily summary run complete", {
      startedAt,
      processed: results.length,
      targetEmail,
    });
    return { ok: true, startedAt, processed: results.length };
  } catch (error) {
    console.error("Daily summary worker failed", error);
    return { ok: false, startedAt, error: error.message };
  }
}

async function fetchLatestInterests(env, targetEmail) {
  const url = new URL("/rest/v1/interests", env.SUPABASE_URL);
  url.searchParams.set("select", "user_id,email,topics,updated_at");
  url.searchParams.set("order", "updated_at.desc");
  // Fetch a reasonable number of rows and filter in memory; avoids subtle eq encoding issues.
  url.searchParams.set("limit", "250");

  const res = await fetch(url, {
    headers: supabaseHeaders(env),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Supabase interests fetch failed", {
      status: res.status,
      body,
      targetEmail,
    });
    throw new Error(`Supabase interests fetch failed: ${res.status}`);
  }
  const rows = await res.json();
  const seen = new Set();
  const latestByUser = [];

  for (const row of rows) {
    if (!row.user_id || seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    latestByUser.push({
      user_id: row.user_id,
      email: row.email,
      topics: normalizeTopics(row.topics),
      updated_at: row.updated_at,
    });
  }

  let filtered = latestByUser;
  if (targetEmail) {
    const needle = targetEmail.trim().toLowerCase();
    filtered = latestByUser.filter(
      (entry) => entry.email && entry.email.toLowerCase() === needle
    );
    if (!filtered.length) {
      console.log("No entries matched target email after client-side filter", {
        targetEmail,
        rowsReceived: rows.length,
      });
    }
  }

  console.log("Fetched interests", {
    targetEmail,
    rowsReceived: rows.length,
    uniqueUsers: latestByUser.length,
    matchedUsers: filtered.length,
  });
  return filtered;
}

async function generateSummary(env, entry) {
  const topics = Array.from(new Set(entry.topics)).slice(0, MAX_TOPICS);
  const prompt = buildPrompt(entry.email, topics);

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are a concise research assistant. Summaries must stay under 120 words, mention at most three highlights, and sound upbeat but factual.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }

  const completion = await res.json();
  const message = completion?.choices?.[0]?.message?.content?.trim();
  if (!message) throw new Error("OpenAI returned empty content");
  return message;
}

async function saveSummary(env, payload) {
  const url = new URL("/rest/v1/daily_summaries", env.SUPABASE_URL);
  const body = {
    ...payload,
    id: crypto.randomUUID(),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const responseBody = await res.text();
    console.error("Supabase summary save failed", {
      status: res.status,
      body: responseBody,
      payload,
    });
    throw new Error(`Supabase summary save failed: ${res.status} ${responseBody}`);
  }
}

function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function normalizeTopics(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch (error) {
      return raw.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function buildPrompt(email, topics) {
  const list = topics.map((topic, index) => `${index + 1}. ${topic}`).join("\n");
  return `The user (${email}) cares about these topics:\n${list}\n\nWrite a short daily digest covering timely developments or tips for those topics. Mention each topic only if you have something concrete to say.`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeJson(request) {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}
