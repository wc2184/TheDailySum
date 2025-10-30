import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kiyzzceobywaaakzgimq.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpeXp6Y2VvYnl3YWFha3pnaW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyMzI5OTAsImV4cCI6MjA3NjgwODk5MH0.U0Ny1o222nQKFDCnK5Ealm-5_xLycb3NsiPHf_yRk3A";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function App() {
  const [email, setEmail] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [log, setLog] = useState([]);
  const [interestsInput, setInterestsInput] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [myInterests, setMyInterests] = useState([]);

  const appendLog = (message) =>
    setLog((entries) => [...entries, `${new Date().toLocaleTimeString()} ${message}`]);

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
      return;
    }

    const fetchOwnInterests = async () => {
      const { data, error } = await supabase
        .from("interests")
        .select("topics, updated_at")
        .eq("email", sessionEmail)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) {
        appendLog(`Auto fetch error: ${error.message}`);
        return;
      }

      if (!data.length) {
        appendLog("No interests saved yet.");
        setMyInterests([]);
        return;
      }

      const entry = data[0];
      setMyInterests(entry.topics);
      appendLog(
        `Latest interests loaded (${new Date(entry.updated_at).toLocaleString()}): ${entry.topics.join(
          ", "
        )}`
      );
    };

    fetchOwnInterests();
  }, [sessionEmail]);

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

    const { error: upsertError } = await supabase.from("interests").upsert(
      {
        user_id: user.id,
        email: user.email,
        topics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    appendLog(upsertError ? `Save error: ${upsertError.message}` : "Interests saved.");
    if (!upsertError) setMyInterests(topics);
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
        <button onClick={handleSignOut} disabled={!sessionEmail}>
          Sign out
        </button>
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
};
