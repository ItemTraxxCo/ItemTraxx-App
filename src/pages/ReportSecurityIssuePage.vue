<template>
  <div class="security-report-page">
    <div class="security-report-orb security-report-orb-one" aria-hidden="true"></div>
    <div class="security-report-orb security-report-orb-two" aria-hidden="true"></div>
    <div class="grid-noise" aria-hidden="true"></div>

    <main class="security-report-container">
      <div class="page-nav-left security-report-top-nav">
        <RouterLink class="security-report-back-link" to="/security" aria-label="Return to security page">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </RouterLink>
        <span class="security-report-breadcrumb">Report Security Issue</span>
      </div>

      <section class="security-report-hero">
        <p class="security-report-eyebrow">Security reporting</p>
        <h1>Report a security issue privately.</h1>
        <p class="security-report-lead">
          Use this page to submit a dedicated security report. For confirmed or suspected security issues,
          include clear reproduction details and limit testing to the minimum needed to verify the issue.
        </p>
      </section>

      <section class="security-report-layout">
        <section class="security-report-card security-report-form-card">
          <p class="security-report-section-label">Submission</p>
          <h2>Send us something you found.</h2>

          <form class="form" @submit.prevent="handleSend">
            <label>
              Name
              <input
                v-model.trim="fullName"
                type="text"
                required
                maxlength="120"
                placeholder="Your full name"
              />
            </label>

            <label>
              Reply email address
              <input
                v-model.trim="replyEmail"
                type="email"
                required
                maxlength="160"
                placeholder="security@example.org"
              />
            </label>

            <label>
              Short summary
              <input
                v-model.trim="summary"
                type="text"
                required
                maxlength="160"
                placeholder="Short title for the issue"
              />
            </label>

            <label>
              Severity estimate
              <select v-model="severity">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="unknown">Unsure</option>
              </select>
            </label>

            <label>
              Affected page or process
              <input
                v-model.trim="affectedArea"
                type="text"
                maxlength="160"
                placeholder="/login, /tenant/checkout, admin action, checkout, return, etc."
              />
            </label>

            <label>
              Report details
              <textarea
                v-model.trim="details"
                rows="8"
                maxlength="4000"
                placeholder="Describe what you found, how to reproduce it, and what impact you believe it has. And any other details that can help us understand and verify the issue."
              ></textarea>
            </label>

            <label>
              Attach images (optional, max 2 images)
              <input
                ref="attachmentsInput"
                type="file"
                accept="image/*"
                multiple
                @change="handleAttachmentChange"
              />
              <p class="muted">Supported file types: PNG, JPG, WEBP, or GIF. Maximum 2 images, up to 4 MB each.</p>
            </label>

            <ul v-if="attachments.length" class="attachment-list">
              <li v-for="file in attachments" :key="file.filename">
                <span>{{ file.filename }}</span>
                <span class="muted">{{ formatAttachmentSize(file.size_bytes) }}</span>
              </li>
            </ul>

            <label v-if="turnstileSiteKey">
              Security Check
              <div :ref="setTurnstileContainerRef"></div>
              <p class="muted">Complete the security check to enable send.</p>
            </label>

            <input
              v-model="website"
              type="text"
              class="honeypot"
              autocomplete="off"
              tabindex="-1"
              aria-hidden="true"
            />

            <div class="form-actions">
              <button type="submit" class="button-primary" :disabled="isSending || !canSubmit">
                {{ isSending ? "Sending..." : "Send security report" }}
              </button>
            </div>
            <p class="security-report-legal-note">
              By sending, you agree to <RouterLink to="/legal">Legal</RouterLink>.
            </p>
          </form>

          <p v-if="error" class="error">{{ error }}</p>
          <p v-if="success" class="success">{{ success }}</p>
        </section>

        <section class="security-report-side">
          <article class="security-report-card">
            <p class="security-report-section-label">Include</p>
            <h2>What to send.</h2>
            <ul class="security-report-list">
              <li v-for="item in reportContents" :key="item.title">
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </li>
            </ul>
          </article>

          <article class="security-report-card">
            <p class="security-report-section-label">Avoid</p>
            <h2>What not to do.</h2>
            <ul class="security-report-list">
              <li v-for="item in avoidList" :key="item.title">
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </li>
            </ul>
          </article>

          <article class="security-report-card">
            <p class="security-report-section-label">Reference</p>
            <h2>Current disclosure reference.</h2>
            <p>
              The current public reporting reference is
              <a href="https://itemtraxx.com/.well-known/security.txt" target="_blank" rel="noreferrer">security.txt</a>.
            </p>
            <p>
              If your issue is not security-related, use <RouterLink to="/contact-support">Contact Support</RouterLink>
              instead.
            </p>
          </article>
        </section>
      </section>

      <PublicFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import PublicFooter from "../components/PublicFooter.vue";
import { useTurnstile } from "../composables/useTurnstile";
import { submitContactSupportRequest } from "../services/contactSupportService";
import { toUserFacingErrorMessage } from "../services/appErrors";

type SupportAttachment = {
  filename: string;
  content_type: string;
  content_base64: string;
  size_bytes: number;
};

const fullName = ref("");
const replyEmail = ref("");
const summary = ref("");
const severity = ref<"low" | "medium" | "high" | "critical" | "unknown">("unknown");
const affectedArea = ref("");
const details = ref("");
const website = ref("");
const attachments = ref<SupportAttachment[]>([]);
const attachmentsInput = ref<HTMLInputElement | null>(null);
const isSending = ref(false);
const error = ref("");
const success = ref("");
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const {
  containerRef: turnstileContainerRef,
  token: turnstileToken,
  reset: resetTurnstile,
} = useTurnstile(turnstileSiteKey);

const setTurnstileContainerRef = (
  el: Element | { $el?: Element } | null
) => {
  if (el instanceof HTMLElement) {
    turnstileContainerRef.value = el;
    return;
  }
  if (el && "$el" in el && el.$el instanceof HTMLElement) {
    turnstileContainerRef.value = el.$el;
    return;
  }
  turnstileContainerRef.value = null;
};

const canSubmit = computed(() => {
  if (!fullName.value || !replyEmail.value || !summary.value || !details.value) return false;
  if (turnstileSiteKey && !turnstileToken.value) return false;
  return true;
});

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToAttachment = (file: File) =>
  new Promise<SupportAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      const contentBase64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        content_base64: contentBase64,
        size_bytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  });

const handleAttachmentChange = async (event: Event) => {
  error.value = "";
  const target = event.target as HTMLInputElement | null;
  const files = Array.from(target?.files ?? []);
  if (files.length === 0) {
    attachments.value = [];
    return;
  }
  if (files.length > 2) {
    error.value = "Attach up to 2 images.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const invalidType = files.find((file) => !file.type.startsWith("image/"));
  if (invalidType) {
    error.value = "Only image attachments are allowed.";
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  const oversized = files.find((file) => file.size > 4 * 1024 * 1024);
  if (oversized) {
    error.value = `${oversized.name} is larger than 4 MB.`;
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
    return;
  }
  try {
    attachments.value = await Promise.all(files.map((file) => fileToAttachment(file)));
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to process attachments.");
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    attachments.value = [];
  }
};

const handleSend = () => {
  void send();
};

const send = async () => {
  error.value = "";
  success.value = "";
  if (!canSubmit.value || (turnstileSiteKey && !turnstileToken.value)) {
    error.value = "Complete required fields and security check.";
    return;
  }
  isSending.value = true;
  try {
    const renderedMessage = [
      `Security report severity: ${severity.value}`,
      affectedArea.value ? `Affected area: ${affectedArea.value}` : null,
      "",
      details.value,
    ]
      .filter(Boolean)
      .join("\n");

    await submitContactSupportRequest({
      name: fullName.value,
      reply_email: replyEmail.value,
      subject: `[Security Report] ${summary.value}`,
      category: "bug",
      message: renderedMessage,
      turnstile_token: turnstileToken.value ?? "",
      website: website.value,
      attachments: attachments.value,
    });

    success.value = "Security report sent. You will receive a confirmation email from support@itemtraxx.com shortly.";
    summary.value = "";
    affectedArea.value = "";
    details.value = "";
    website.value = "";
    attachments.value = [];
    if (attachmentsInput.value) attachmentsInput.value.value = "";
    resetTurnstile();
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to send security report.");
  } finally {
    isSending.value = false;
  }
};

const reportContents = [
  {
    title: "Clear summary",
    description: "Describe what you found, what you expected, and why you believe it is security-sensitive.",
  },
  {
    title: "Reproduction steps",
    description: "Include the exact steps, route, tenant context, and whether the issue requires authentication.",
  },
  {
    title: "Impact",
    description: "Explain the likely effect: unauthorized access, data exposure, privilege escalation, or workflow bypass.",
  },
  {
    title: "Evidence",
    description: "Attach screenshots, request details, console output, or other proof that helps confirm the issue quickly.",
  },
];

const avoidList = [
  {
    title: "No public disclosure first",
    description: "Do not post suspected security issues publicly before ItemTraxx has had a chance to review them.",
  },
  {
    title: "Do not access unrelated data",
    description: "Limit testing to the minimum needed to verify the issue. Do not browse, export, or retain unrelated user data.",
  },
  {
    title: "Do not disrupt service",
    description: "Avoid destructive testing, denial-of-service behavior, or actions that could interrupt real users.",
  },
];
</script>

<style scoped>
.security-report-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  max-width: 100%;
  padding: calc(2rem + env(safe-area-inset-top, 0px)) 0 calc(3.5rem + env(safe-area-inset-bottom, 0px));
  background-color: #0a1120;
  color: #f5f7fb;
  overflow-x: hidden;
}

.security-report-page::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(circle at 14% 18%, rgba(25, 194, 168, 0.16), transparent 34%),
    radial-gradient(circle at 83% 10%, rgba(25, 67, 155, 0.18), transparent 31%),
    linear-gradient(180deg, #09111f 0%, #0d1524 48%, #0a1120 100%);
  pointer-events: none;
}

.security-report-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  opacity: 0.38;
  pointer-events: none;
}

.security-report-orb-one {
  width: 20rem;
  height: 20rem;
  top: 5rem;
  left: -6rem;
  background: rgba(30, 202, 183, 0.24);
}

.security-report-orb-two {
  width: 24rem;
  height: 24rem;
  top: 9rem;
  right: -8rem;
  background: rgba(38, 104, 226, 0.2);
}

.security-report-container {
  position: relative;
  z-index: 1;
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.security-report-top-nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
}

.security-report-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid rgba(136, 154, 184, 0.28);
  background: rgba(10, 17, 31, 0.72);
  color: #f5f7fb;
  transition: border-color 160ms ease, transform 160ms ease;
}

.security-report-back-link:hover {
  border-color: rgba(56, 208, 177, 0.55);
  transform: translateX(-1px);
}

.security-report-back-link svg {
  width: 1.1rem;
  height: 1.1rem;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.security-report-breadcrumb,
.security-report-eyebrow,
.security-report-section-label {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(168, 183, 212, 0.72);
}

.security-report-hero,
.security-report-card {
  position: relative;
  overflow: hidden;
  border-radius: 1.8rem;
  border: 1px solid rgba(112, 138, 180, 0.16);
  background: linear-gradient(180deg, rgba(17, 27, 45, 0.94), rgba(10, 17, 31, 0.92));
  box-shadow: 0 22px 54px rgba(4, 8, 20, 0.32);
}

.security-report-hero {
  padding: 1.9rem;
}

.security-report-hero h1,
.security-report-card h2 {
  margin: 0.65rem 0 0.9rem;
  font-size: clamp(1.75rem, 4vw, 3.2rem);
  line-height: 1.06;
  letter-spacing: -0.05em;
}

.security-report-card h2 {
  font-size: clamp(1.2rem, 2vw, 1.75rem);
}

.security-report-lead,
.security-report-card p,
.security-report-list span {
  margin: 0;
  color: rgba(231, 236, 245, 0.78);
  line-height: 1.7;
}

.security-report-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 0.9fr);
  gap: 1rem;
  margin-top: 1rem;
}

.security-report-form-card,
.security-report-side {
  display: grid;
  gap: 1rem;
}

.security-report-card {
  padding: 1.35rem;
}

.security-report-list {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.8rem;
}

.security-report-list li {
  display: grid;
  gap: 0.18rem;
}

.security-report-page a {
  color: #7de7d6;
}

.security-report-legal-note {
  margin: 0.4rem 0 0;
  color: rgba(231, 236, 245, 0.68);
  font-size: 0.92rem;
}

.attachment-list {
  margin: 0;
  padding-left: 1.1rem;
}

.attachment-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.honeypot {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

@media (max-width: 900px) {
  .security-report-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .security-report-page {
    padding-top: calc(1.25rem + env(safe-area-inset-top, 0px));
  }

  .security-report-container {
    width: min(100%, calc(100% - 1.25rem));
  }

  .security-report-hero,
  .security-report-card {
    padding: 1.15rem 1rem;
    border-radius: 1.15rem;
  }
}
</style>
