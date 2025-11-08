import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kiyzzceobywaaakzgimq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpeXp6Y2VvYnl3YWFha3pnaW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyMzI5OTAsImV4cCI6MjA3NjgwODk5MH0.U0Ny1o222nQKFDCnK5Ealm-5_xLycb3NsiPHf_yRk3A";
const WORKER_URL = import.meta.env.VITE_DAILY_WORKER_URL || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function App() {
  const [email, setEmail] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [log, setLog] = useState([]);
  const [interestsInput, setInterestsInput] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [myInterests, setMyInterests] = useState([]);
  const [interestHistory, setInterestHistory] = useState([]);
  const [dailySummary, setDailySummary] = useState(null);
  const [summaryHistory, setSummaryHistory] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [forceRunning, setForceRunning] = useState(false);

  const appendLog = useCallback((message) => {
    setLog((entries) => [...entries, `${new Date().toLocaleTimeString()} ${message}`]);
  }, []);

  const applySummaryRecord = useCallback((record) => {
    if (!record) {
      setDailySummary(null);
      return;
    }

    setDailySummary({
      text: record.summary_text,
      generatedAt: record.generated_at,
    });
  }, []);

  const reloadInterests = useCallback(async () => {
    if (!sessionEmail) {
      setInterestHistory([]);
      setMyInterests([]);
      return [];
    }

    const { data, error } = await supabase
      .from("interests")
      .select("topics, updated_at")
      .eq("email", sessionEmail)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (error) throw error;
    setInterestHistory(data);
    setMyInterests(data[0]?.topics ?? []);
    return data;
  }, [sessionEmail]);

  const reloadSummaries = useCallback(async () => {
    if (!sessionEmail) {
      setSummaryHistory([]);
      setDailySummary(null);
      return [];
    }

    const { data, error } = await supabase
      .from("daily_summaries")
      .select("summary_text, generated_at")
      .eq("email", sessionEmail)
      .order("generated_at", { ascending: false })
      .limit(5);

    if (error) throw error;
    setSummaryHistory(data);
    applySummaryRecord(data[0] ?? null);
    return data;
  }, [sessionEmail, applySummaryRecord]);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (session?.user?.email) {
        setSessionEmail(session.user.email);
        appendLog(`Restored session for ${session.user.email}`);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      const emailFromSession = session?.user?.email ?? "";

      if (emailFromSession) {
        setSessionEmail(emailFromSession);
        if (event === "INITIAL_SESSION") return;
        if (event === "TOKEN_REFRESHED") return;
        appendLog(`Logged in as ${emailFromSession}`);
      } else if (event === "SIGNED_OUT") {
        setSessionEmail("");
        appendLog("Logged out.");
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionEmail) {
      setMyInterests([]);
      setInterestHistory([]);
      return;
    }

    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const records = await reloadInterests();
        if (cancelled) return;
        if (!records.length) {
          appendLog("No interests saved yet.");
          return;
        }

        const entry = records[0];
        appendLog(
          `Latest interests loaded (${new Date(entry.updated_at).toLocaleString()}): ${entry.topics.join(
            ", "
          )}`
        );
      } catch (error) {
        if (!cancelled) appendLog(`Auto fetch error: ${error.message}`);
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [sessionEmail, reloadInterests, appendLog]);

  useEffect(() => {
    if (!sessionEmail) {
      setDailySummary(null);
      setSummaryHistory([]);
      return;
    }

    let cancelled = false;
    const loadSummary = async () => {
      setSummaryLoading(true);
      try {
        const records = await reloadSummaries();
        if (cancelled) return;
        appendLog(records.length ? "Loaded daily summary." : "No summary generated yet.");
      } catch (error) {
        if (!cancelled) appendLog(`Summary fetch error: ${error.message}`);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    };

    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [sessionEmail, reloadSummaries, appendLog]);

  const handleMagicLink = async () => {
    if (!email.trim()) return appendLog("Enter an email first.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setLoading(false);
    appendLog(error ? `Magic link error: ${error.message}` : "Magic link sent.");
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error, data } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) appendLog(`Google sign-in error: ${error.message}`);
    else if (!data?.url) appendLog("No redirect URL received for Google sign-in.");
    else appendLog("Redirecting to Google...");
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    appendLog(error ? `Sign-out error: ${error.message}` : "Signed out.");
  };

  const handleInsertEvent = async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      appendLog("Need to be logged in before inserting.");
      return;
    }

    const { error: insertError } = await supabase.from("events").insert({
      user_id: user.id,
      type: "signup",
      meta: { plan: "pro" },
    });

    appendLog(insertError ? `Insert error: ${insertError.message}` : "Inserted demo event.");
  };

  const handleSaveInterests = async () => {
    const topics = interestsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!topics.length) {
      appendLog("Add at least one interest.");
      return;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      appendLog("Need to be logged in before saving interests.");
      return;
    }

    const { error: insertError } = await supabase.from("interests").insert({
      user_id: user.id,
      email: user.email,
      topics,
      updated_at: new Date().toISOString(),
    });

    appendLog(insertError ? `Save error: ${insertError.message}` : "Interests saved.");
    if (!insertError) {
      try {
        await reloadInterests();
      } catch (error) {
        appendLog(`Refresh error: ${error.message}`);
      }
    }
  };

  const handleFetchInterests = async () => {
    if (!lookupEmail.trim()) {
      appendLog("Enter an email to fetch.");
      return;
    }

    const { data, error } = await supabase
      .from("interests")
      .select("email, topics, updated_at")
      .eq("email", lookupEmail.trim())
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      appendLog(`Fetch error: ${error.message}`);
      return;
    }

    if (!data.length) {
      appendLog("No interests found for that email.");
      return;
    }

    const entry = data[0];
    appendLog(
      `Latest interests for ${entry.email}: ${entry.topics.join(", ")} (updated ${new Date(
        entry.updated_at
      ).toLocaleString()})`
    );
  };

  const logOutput = useMemo(() => log.join("\n"), [log]);

  const handleRefreshSummary = async () => {
    if (!sessionEmail) {
      appendLog("Log in to refresh the summary.");
      return;
    }

    setSummaryLoading(true);
    appendLog("Refreshing summary...");
    try {
      const records = await reloadSummaries();
      appendLog(
        records.length ? "Summary refreshed." : "No summary generated yet. Wait for the worker to run."
      );
    } catch (error) {
      appendLog(`Summary refresh error: ${error.message}`);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleForceSummary = async () => {
    if (!sessionEmail) {
      appendLog("Log in to trigger a summary.");
      return;
    }
    if (!WORKER_URL) {
      appendLog("Set VITE_DAILY_WORKER_URL to call the worker.");
      return;
    }

    setForceRunning(true);
    appendLog("Triggering worker run for your email...");
    try {
      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sessionEmail }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Worker responded with ${response.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const records = await reloadSummaries();
      appendLog(
        records.length ? "Summary generated via worker." : "Worker ran but no summary was returned."
      );
    } catch (error) {
      appendLog(`Worker trigger error: ${error.message}`);
    } finally {
      setForceRunning(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Supabase Interests</h2>
      <section style={styles.section}>
        <label style={styles.label}>Email</label>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            disabled={loading}
          />
          <button onClick={handleMagicLink} disabled={loading}>
            Send Magic Link
          </button>
          <button onClick={handleGoogleSignIn} disabled={loading}>
            Sign in with Google
          </button>
        </div>
        {sessionEmail && <p style={styles.subtle}>Signed in as {sessionEmail}</p>}
      </section>

      <section style={styles.section}>
        <button onClick={handleInsertEvent} disabled={!sessionEmail}>
          Insert Demo Event
        </button>
      </section>

      <section style={styles.section}>
        <label style={styles.label}>Save Interests</label>
        <textarea
          style={{ ...styles.input, minHeight: 72 }}
          value={interestsInput}
          onChange={(event) => setInterestsInput(event.target.value)}
          placeholder="usa politics, immigration, huberman, lex fridman"
          disabled={!sessionEmail}
        />
        <button onClick={handleSaveInterests} disabled={!sessionEmail}>
          Save Interests
        </button>
      </section>

      <section style={styles.section}>
        <label style={styles.label}>Your Saved Interests</label>
        <p style={styles.subtle}>
          {sessionEmail
            ? myInterests.length
              ? myInterests.join(", ")
              : "No interests saved yet."
            : "Log in to view your interests."}
        </p>
        {sessionEmail && interestHistory.length > 0 && (
          <details style={styles.historyBlock}>
            <summary style={styles.dropdownSummary}>
              <span>Recent interest updates</span>
              <span style={styles.dropdownArrow}>▼</span>
            </summary>
            <ul style={styles.historyList}>
              {interestHistory.map((entry, index) => (
                <li key={`${entry.updated_at}-${index}`} style={styles.historyItem}>
                  <span style={styles.historyTimestamp}>{formatTimestamp(entry.updated_at)}</span>
                  <span style={styles.historyBody}>
                    {entry.topics?.length ? entry.topics.join(", ") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <button onClick={handleSignOut} disabled={!sessionEmail}>
          Sign out
        </button>
      </section>

      <section style={styles.section}>
        <label style={styles.label}>Daily AI Summary</label>
        {!sessionEmail && <p style={styles.subtle}>Log in to see your personalized digest.</p>}
        {sessionEmail && (
          <div style={styles.summaryCard}>
            {summaryLoading ? (
              <p style={styles.subtle}>Fetching summary...</p>
            ) : dailySummary ? (
              <>
                <div
                  style={styles.markdown}
                  dangerouslySetInnerHTML={{ __html: renderSummaryMarkdown(dailySummary.text) }}
                />
                <p style={styles.subtle}>
                  Generated {new Date(dailySummary.generatedAt).toLocaleString()}
                </p>
              </>
            ) : (
              <p style={styles.subtle}>
                No summary yet. The Cloudflare worker will drop one here after it runs.
              </p>
            )}
            <div style={styles.buttonStack}>
              <button onClick={handleRefreshSummary} disabled={!sessionEmail || summaryLoading}>
                Refresh Summary
              </button>
              <button
                onClick={handleForceSummary}
                disabled={!sessionEmail || forceRunning || !WORKER_URL}
              >
                Force Generate via Worker
              </button>
            </div>
            {summaryHistory.length > 0 && (
              <details style={styles.historyBlock}>
                <summary style={styles.dropdownSummary}>
                  <span>Recent digests</span>
                  <span style={styles.dropdownArrow}>▼</span>
                </summary>
                <ul style={styles.historyList}>
                  {summaryHistory.map((entry, index) => (
                    <li key={`${entry.generated_at}-${index}`} style={styles.historyItem}>
                      <span style={styles.historyTimestamp}>{formatTimestamp(entry.generated_at)}</span>
                      <span style={styles.historyBody}>{truncateText(entry.summary_text)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!WORKER_URL && (
              <p style={styles.subtle}>
                Add <code>VITE_DAILY_WORKER_URL</code> to your Vite env file to enable force runs.
              </p>
            )}
          </div>
        )}
      </section>

      <section style={styles.section}>
        <label style={styles.label}>Lookup Interests by Email</label>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={lookupEmail}
            onChange={(event) => setLookupEmail(event.target.value)}
            placeholder="friend@example.com"
          />
          <button onClick={handleFetchInterests}>Fetch</button>
        </div>
      </section>

      <section style={styles.section}>
        <label style={styles.label}>Log</label>
        <pre style={styles.log}>{logOutput || "—"}</pre>
      </section>
    </div>
  );
}

const styles = {
  wrap: {
    fontFamily: "system-ui, sans-serif",
    margin: "0 auto",
    padding: "2rem 1.5rem 4rem",
    maxWidth: 560,
    lineHeight: 1.4,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  row: {
    display: "flex",
    gap: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.5rem",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "1rem",
  },
  label: {
    fontWeight: 600,
  },
  subtle: {
    color: "#666",
    fontSize: "0.9rem",
  },
  log: {
    minHeight: "120px",
    border: "1px solid #eee",
    borderRadius: "4px",
    padding: "0.75rem",
    background: "#fafafa",
    whiteSpace: "pre-wrap",
  },
  summaryCard: {
    border: "1px solid #e9e9e9",
    borderRadius: "6px",
    padding: "0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    background: "#fff",
  },
  buttonStack: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  markdown: {
    lineHeight: 1.5,
    whiteSpace: "normal",
  },
  historyBlock: {
    borderTop: "1px solid #f0f0f0",
    paddingTop: "0.5rem",
    marginTop: "0.5rem",
  },
  dropdownSummary: {
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.95rem",
    marginBottom: "0.35rem",
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
  },
  dropdownArrow: {
    fontSize: "0.85rem",
    marginLeft: "0.25rem",
    paddingLeft: "0.1rem",
  },
  historyHeading: {
    fontSize: "0.9rem",
    fontWeight: 600,
    marginBottom: "0.35rem",
  },
  historyList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  historyItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
  },
  historyTimestamp: {
    fontSize: "0.8rem",
    color: "#555",
  },
  historyBody: {
    fontSize: "0.95rem",
  },
};

function renderSummaryMarkdown(text) {
  if (!text) return "";
  return basicMarkdownToHtml(text);
}

function formatTimestamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function truncateText(value, max = 160) {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function basicMarkdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  const formatted = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s])_(.+?)_/g, (_, prefix, content) => `${prefix}<em>${content}</em>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  const blocks = formatted
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line.trim()));
      if (bulletLines.length === lines.length && bulletLines.length > 0) {
        const items = bulletLines
          .map((line) => line.replace(/^[-*]\s+/, "").trim())
          .map((item) => `<li>${item}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${block.replace(/\n/g, "<br />")}</p>`;
    });

  return blocks.join("") || `<p>${formatted}</p>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}
