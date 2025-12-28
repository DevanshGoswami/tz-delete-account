import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import "./App.css";
import logo from "./assets/logo.png";

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ??
  "https://api.tzilla.live/api";
const REQUEST_ENDPOINT = `${API_BASE}/profile/deletemyaccount/request`;
const VERIFY_ENDPOINT = `${API_BASE}/profile/deletemyaccount/verify`;
const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ??
  "6LdnIxIsAAAAAE2uHK-wvx_pmjNrm-ZxAbAc1VV8";

type ApiMessage = {
  msg?: string;
};

type Notice = {
  type: "success" | "error";
  text: string;
};

interface ReCaptchaHandle {
  reset: () => void;
}

type Grecaptcha = {
  render: (
    container: Element,
    parameters: {
      sitekey: string;
      theme?: "dark" | "light";
      size?: "compact" | "normal";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
    }
  ) => number;
  reset: (widgetId?: number) => void;
  ready: (cb: () => void) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

const RecaptchaWidget = forwardRef<
  ReCaptchaHandle,
  { label: string; onTokenChange: (token: string | null) => void }
>(({ label, onTokenChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && !!window.grecaptcha
  );
  const [widgetId, setWidgetId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || scriptReady) {
      return;
    }

    if (window.grecaptcha) {
      setScriptReady(true);
      return;
    }

    const existingScript =
      document.querySelector<HTMLScriptElement>("#recaptcha-script");
    if (existingScript) {
      const handleLoad = () => setScriptReady(true);
      existingScript.addEventListener("load", handleLoad);
      return () => existingScript.removeEventListener("load", handleLoad);
    }

    const script = document.createElement("script");
    script.id = "recaptcha-script";
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;

    const handleLoad = () => setScriptReady(true);
    script.addEventListener("load", handleLoad);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", handleLoad);
    };
  }, [scriptReady]);

  useEffect(() => {
    if (!scriptReady || widgetId !== null || !containerRef.current) {
      return;
    }

    const renderWidget = () => {
      if (!containerRef.current || widgetId !== null) {
        return;
      }

      const id = window.grecaptcha!.render(containerRef.current, {
        sitekey: RECAPTCHA_SITE_KEY,
        theme: "dark",
        size: "normal",
        callback: (token) => onTokenChange(token),
        "expired-callback": () => onTokenChange(null),
      });

      setWidgetId(id);
    };

    window.grecaptcha?.ready(renderWidget);
  }, [onTokenChange, scriptReady, widgetId]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (widgetId !== null) {
          window.grecaptcha?.reset(widgetId);
          onTokenChange(null);
        }
      },
    }),
    [onTokenChange, widgetId]
  );

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="recaptcha-box" ref={containerRef}>
        {!scriptReady && (
          <span className="recaptcha-loading">Loading reCAPTCHA…</span>
        )}
      </div>
    </label>
  );
});

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      (typeof data === "object" && data !== null && "msg" in data
        ? String((data as ApiMessage).msg)
        : null) ||
      (typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : null) ||
      text ||
      response.statusText ||
      "Unable to complete the request.";

    throw new Error(message);
  }

  return (data as T) ?? ({} as T);
}

function App() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [requestNotice, setRequestNotice] = useState<Notice | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<Notice | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [hasRequestedBefore, setHasRequestedBefore] = useState(false);

  const requestRecaptchaRef = useRef<ReCaptchaHandle>(null);
  const verifyRecaptchaRef = useRef<ReCaptchaHandle>(null);

  const normalizedEmail = email.trim().toLowerCase();

  const submitRequest = async () => {
    if (!normalizedEmail || !requestToken) {
      setRequestNotice({
        type: "error",
        text: "Enter an email and complete the captcha to continue.",
      });
      return;
    }

    setRequestLoading(true);
    setRequestNotice(null);

    try {
      const data = await postJson<ApiMessage>(REQUEST_ENDPOINT, {
        email: normalizedEmail,
        recaptchaToken: requestToken,
      });

      setRequestNotice({
        type: "success",
        text:
          data.msg ??
          "If this email exists with TrainZilla, an OTP is on its way.",
      });
      setHasRequestedBefore(true);
    } catch (error) {
      setRequestNotice({
        type: "error",
        text:
          (error as Error).message ||
          "Something went wrong while requesting account deletion.",
      });
    } finally {
      setRequestLoading(false);
      setRequestToken(null);
      requestRecaptchaRef.current?.reset();
    }
  };

  const handleRequestSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitRequest();
  };

  const handleVerifySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedEmail || otp.length !== 6 || !verifyToken) {
      setVerifyNotice({
        type: "error",
        text: "Provide the email, OTP, and captcha token to continue.",
      });
      return;
    }

    setVerifyLoading(true);
    setVerifyNotice(null);

    try {
      const data = await postJson<ApiMessage>(VERIFY_ENDPOINT, {
        email: normalizedEmail,
        otp,
        recaptchaToken: verifyToken,
      });

      setVerifyNotice({
        type: "success",
        text:
          data.msg ??
          "Account deletion has been queued. You will receive an email once it starts.",
      });
      setOtp("");
    } catch (error) {
      setVerifyNotice({
        type: "error",
        text:
          (error as Error).message ||
          "Unable to verify the OTP. Please try again.",
      });
    } finally {
      setVerifyLoading(false);
      setVerifyToken(null);
      verifyRecaptchaRef.current?.reset();
    }
  };

  const requestDisabled = !normalizedEmail || !requestToken || requestLoading;
  const verifyDisabled =
    !normalizedEmail || otp.length !== 6 || !verifyToken || verifyLoading;
  const stepTwoLocked = !hasRequestedBefore;

  return (
    <div className="app-shell">
      <div className="glow blur-one" />
      <div className="glow blur-two" />
      <div className="content">
        <header className="hero">
          <div className="hero-badge">Profile settings</div>
          <img src={logo} alt="TrainZilla" className="hero-logo" />
          <h1>Delete your TrainZilla account</h1>
          <p className="hero-lead">
            This permanently removes every bit of your TrainZilla data and
            cannot be undone. Please double-check before continuing.
          </p>
          <div className="warning-banner">
            <p>
              Once you confirm, all workouts, chats, payments, plans, and
              profile data will be deleted forever. Reach out to{" "}
              <a href="mailto:support@trainzilla.in">support@trainzilla.in</a>{" "}
              if you’re unsure.
            </p>
          </div>
        </header>

        <main className="panel-grid">
          <section className="panel">
            <div className="panel-heading">
              <span className="panel-pill">Step 1</span>
              <h2>Request account deletion</h2>
              <p>
                Use the email associated with your TrainZilla login. We always
                respond with the same generic confirmation, even if the email
                does not exist.
              </p>
            </div>

            <form className="panel-form" onSubmit={handleRequestSubmit}>
              <label className="field">
                <span className="field-label">Email address</span>
                <input
                  type="email"
                  name="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="trainer@trainzilla.app"
                  autoComplete="email"
                />
              </label>

              <RecaptchaWidget
                ref={requestRecaptchaRef}
                label="Verify you’re human"
                onTokenChange={setRequestToken}
              />

              <button type="submit" disabled={requestDisabled}>
                {requestLoading ? "Sending OTP…" : "Email me the OTP"}
              </button>
              {hasRequestedBefore && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void submitRequest()}
                  disabled={requestDisabled}
                  title="Solve the captcha again if it has expired."
                >
                  Resend OTP
                </button>
              )}
            </form>

            {requestNotice && (
              <p className={`notice ${requestNotice.type}`}>
                {requestNotice.text}
              </p>
            )}

            <div className="panel-footer">
              <p>
                Submission is rate limited and guarded by reCAPTCHA. Requesting
                a fresh OTP immediately invalidates the previous code.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <span className="panel-pill">Step 2</span>
              <h2>Verify the OTP</h2>
              <p>
                This step unlocks after your OTP request succeeds. Enter the
                same email plus the 6 digit code to confirm deletion.
              </p>
            </div>

            {stepTwoLocked ? (
              <div className="locked-state">
                <p>Request an OTP above to unlock verification.</p>
              </div>
            ) : (
              <>
                <form className="panel-form" onSubmit={handleVerifySubmit}>
                  <label className="field">
                    <span className="field-label">Email address</span>
                    <input
                      type="email"
                      name="email-verify"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="trainer@trainzilla.app"
                      autoComplete="email"
                    />
                  </label>

                  <label className="field">
                    <span className="field-label">OTP</span>
                    <input
                      type="text"
                      name="otp"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      placeholder="••••••"
                      maxLength={6}
                      value={otp}
                      onChange={(event) =>
                        setOtp(
                          event.target.value.replace(/\D/g, "").slice(0, 6)
                        )
                      }
                    />
                  </label>

                  <RecaptchaWidget
                    ref={verifyRecaptchaRef}
                    label="Solve reCAPTCHA again"
                    onTokenChange={setVerifyToken}
                  />

                  <button type="submit" disabled={verifyDisabled}>
                    {verifyLoading ? "Verifying…" : "Verify & queue deletion"}
                  </button>
                </form>

                {verifyNotice && (
                  <p className={`notice ${verifyNotice.type}`}>
                    {verifyNotice.text}
                  </p>
                )}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
